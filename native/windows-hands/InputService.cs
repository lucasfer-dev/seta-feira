using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Sexta.NativeHands
{
    internal static class InputService
    {
        internal static void Click(int x, int y)
        {
            if (!NativeMethods.SetCursorPos(x, y)) throw new InvalidOperationException("PC_UI_CURSOR_MOVE_FAILED");
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        }

        internal static bool Unicode(string value)
        {
            foreach (var ch in value ?? string.Empty)
            {
                var down = new NativeMethods.INPUT
                {
                    type = NativeMethods.INPUT_KEYBOARD,
                    U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = NativeMethods.KEYEVENTF_UNICODE } }
                };
                var up = new NativeMethods.INPUT
                {
                    type = NativeMethods.INPUT_KEYBOARD,
                    U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = 0, wScan = ch, dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP } }
                };
                if (NativeMethods.SendInput(2, new[] { down, up }, Marshal.SizeOf(typeof(NativeMethods.INPUT))) != 2) return false;
            }
            return true;
        }

        internal static bool CtrlA()
        {
            return Key(0x11, false) && Key(0x41, false) && Key(0x41, true) && Key(0x11, true);
        }

        internal static object Hotkey(string shortcut)
        {
            var normalized = Normalize(shortcut);
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "ctrl+f","ctrl+l","ctrl+c","ctrl+a","ctrl+z","ctrl+y","ctrl+tab","ctrl+shift+tab",
                "alt+left","alt+right","alt+tab","esc","f5","home","end","pageup","pagedown",
                "left","right","up","down","shift+tab","tab"
            };
            if (!allowed.Contains(normalized)) throw new InvalidOperationException("PC_UI_HOTKEY_NOT_ALLOWED");

            var parts = normalized.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            var modifiers = new List<ushort>();
            ushort key = 0;
            foreach (var raw in parts)
            {
                var part = raw.Trim();
                if (part == "ctrl") modifiers.Add(0x11);
                else if (part == "alt") modifiers.Add(0x12);
                else if (part == "shift") modifiers.Add(0x10);
                else key = Code(part);
            }
            if (key == 0) throw new InvalidOperationException("PC_UI_HOTKEY_NOT_ALLOWED");
            foreach (var modifier in modifiers) if (!Key(modifier, false)) throw new InvalidOperationException("PC_UI_HOTKEY_SENDINPUT_FAILED");
            if (!Key(key, false) || !Key(key, true)) throw new InvalidOperationException("PC_UI_HOTKEY_SENDINPUT_FAILED");
            for (var i = modifiers.Count - 1; i >= 0; i--) if (!Key(modifiers[i], true)) throw new InvalidOperationException("PC_UI_HOTKEY_SENDINPUT_FAILED");
            return new { ok = true, sent = true, verified = true, shortcut = normalized, via = "SendInput", provider = "native-hands-v3" };
        }

        private static bool Key(ushort vk, bool up)
        {
            var input = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = vk, wScan = 0, dwFlags = up ? NativeMethods.KEYEVENTF_KEYUP : 0 } }
            };
            return NativeMethods.SendInput(1, new[] { input }, Marshal.SizeOf(typeof(NativeMethods.INPUT))) == 1;
        }

        private static string Normalize(string value)
        {
            return (value ?? string.Empty).Trim().ToLowerInvariant().Replace("control", "ctrl").Replace("escape", "esc").Replace(" ", string.Empty);
        }

        private static ushort Code(string value)
        {
            if (value.Length == 1)
            {
                var c = char.ToUpperInvariant(value[0]);
                if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c;
            }
            switch (value)
            {
                case "tab": return 0x09;
                case "esc": return 0x1B;
                case "left": return 0x25;
                case "up": return 0x26;
                case "right": return 0x27;
                case "down": return 0x28;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup": return 0x21;
                case "pagedown": return 0x22;
                case "f5": return 0x74;
                default: return 0;
            }
        }
    }
}
