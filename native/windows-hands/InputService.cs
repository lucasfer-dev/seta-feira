using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace Sexta.NativeHands
{
    internal static class InputService
    {
        internal static void Click(int x, int y)
        {
            MoveCursor(x, y);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
        }

        internal static void DoubleClick(int x, int y)
        {
            MoveCursor(x, y);
            for (var i = 0; i < 2; i++)
            {
                NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                System.Threading.Thread.Sleep(55);
            }
        }

        internal static void RightClick(int x, int y)
        {
            MoveCursor(x, y);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
        }

        internal static void Wheel(int delta)
        {
            var bounded = Math.Max(-1200, Math.Min(1200, delta));
            NativeMethods.mouse_event(NativeMethods.MOUSEEVENTF_WHEEL, 0, 0, unchecked((uint)bounded), UIntPtr.Zero);
        }

        private static void MoveCursor(int x, int y)
        {
            if (!NativeMethods.SetCursorPos(x, y)) throw new InvalidOperationException("PC_UI_CURSOR_MOVE_FAILED");
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
            var requested = (shortcut ?? string.Empty).Trim();
            var normalized = Normalize(requested);
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                // Texto e navegação local.
                "ctrl+f","ctrl+l","ctrl+c","ctrl+a","ctrl+z","ctrl+y","tab","shift+tab","esc",
                "home","end","pageup","pagedown","left","right","up","down",

                // Navegadores: abas, histórico e navegação. Não inclui Enter genérico.
                "ctrl+t","ctrl+w","ctrl+shift+t","ctrl+n","ctrl+r","ctrl+tab","ctrl+shift+tab",
                "ctrl+1","ctrl+2","ctrl+3","ctrl+4","ctrl+5","ctrl+6","ctrl+7","ctrl+8","ctrl+9",
                "alt+left","alt+right","alt+home","f5","f6","f11","ctrl+h","ctrl+j",

                // Windows: organização e troca de janelas sem shell arbitrário.
                "alt+tab","alt+space","win+left","win+right","win+up","win+down",
                "win+shift+left","win+shift+right","ctrl+shift+esc"
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
                else if (part == "win") modifiers.Add(0x5B);
                else key = Code(part);
            }
            if (key == 0) throw new InvalidOperationException("PC_UI_HOTKEY_NOT_ALLOWED");
            foreach (var modifier in modifiers) if (!Key(modifier, false)) throw new InvalidOperationException("PC_UI_HOTKEY_SENDINPUT_FAILED");
            if (!Key(key, false) || !Key(key, true)) throw new InvalidOperationException("PC_UI_HOTKEY_SENDINPUT_FAILED");
            for (var i = modifiers.Count - 1; i >= 0; i--) if (!Key(modifiers[i], true)) throw new InvalidOperationException("PC_UI_HOTKEY_SENDINPUT_FAILED");
            return new { ok = true, sent = true, verified = true, requested, shortcut = normalized, via = "SendInput", provider = "native-hands-v3" };
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
            var phrase = Fold(value).Trim().ToLowerInvariant()
                .Replace('_', ' ')
                .Replace('-', ' ');
            while (phrase.Contains("  ")) phrase = phrase.Replace("  ", " ");

            // Aceita intenção natural além do atalho literal. Isto deixa o modelo dizer
            // “nova aba”, “fecha a aba”, “joga a janela pra esquerda”, etc. sem depender
            // de uma tradução perfeita antes de chegar ao backend nativo.
            if (ContainsAny(phrase, "reabrir aba", "reabre aba", "reabra aba", "reopen tab", "restaurar aba fechada")) return "ctrl+shift+t";
            if (ContainsAny(phrase, "fechar aba", "fecha aba", "feche aba", "close tab", "fechar guia", "fecha guia")) return "ctrl+w";
            if (ContainsAny(phrase, "nova aba", "abrir aba", "abre aba", "new tab", "nova guia", "novo separador")) return "ctrl+t";
            if (ContainsAny(phrase, "proxima aba", "aba seguinte", "next tab", "proxima guia")) return "ctrl+tab";
            if (ContainsAny(phrase, "aba anterior", "previous tab", "guia anterior")) return "ctrl+shift+tab";
            if (ContainsAny(phrase, "nova janela", "abrir janela do navegador", "new window")) return "ctrl+n";
            if (ContainsAny(phrase, "barra de endereco", "barra de enderecos", "address bar", "focar endereco")) return "ctrl+l";
            if (ContainsAny(phrase, "recarregar pagina", "atualizar pagina", "reload page", "refresh page")) return "ctrl+r";
            if (ContainsAny(phrase, "voltar pagina", "pagina anterior", "browser back")) return "alt+left";
            if (ContainsAny(phrase, "avancar pagina", "pagina seguinte", "browser forward")) return "alt+right";
            if (ContainsAny(phrase, "historico do navegador", "browser history")) return "ctrl+h";
            if (ContainsAny(phrase, "downloads do navegador", "abrir downloads", "browser downloads")) return "ctrl+j";
            if (ContainsAny(phrase, "tela cheia", "fullscreen")) return "f11";
            if (ContainsAny(phrase, "encaixar esquerda", "janela para esquerda", "snap left")) return "win+left";
            if (ContainsAny(phrase, "encaixar direita", "janela para direita", "snap right")) return "win+right";
            if (ContainsAny(phrase, "monitor esquerdo", "mover para monitor esquerdo", "move to left monitor")) return "win+shift+left";
            if (ContainsAny(phrase, "monitor direito", "mover para monitor direito", "move to right monitor")) return "win+shift+right";
            if (ContainsAny(phrase, "gerenciador de tarefas", "task manager")) return "ctrl+shift+esc";

            return phrase
                .Replace("control", "ctrl")
                .Replace("escape", "esc")
                .Replace("pagina para cima", "pageup")
                .Replace("pagina para baixo", "pagedown")
                .Replace("page up", "pageup")
                .Replace("page down", "pagedown")
                .Replace(" ", string.Empty);
        }

        private static bool ContainsAny(string value, params string[] needles)
        {
            foreach (var needle in needles)
            {
                if (value.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return true;
            }
            return false;
        }

        private static string Fold(string value)
        {
            var source = (value ?? string.Empty).Normalize(NormalizationForm.FormD);
            var builder = new StringBuilder(source.Length);
            foreach (var ch in source)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(ch) != UnicodeCategory.NonSpacingMark) builder.Append(ch);
            }
            return builder.ToString().Normalize(NormalizationForm.FormC);
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
                case "space": return 0x20;
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
                case "f6": return 0x75;
                case "f11": return 0x7A;
                default: return 0;
            }
        }
    }
}
