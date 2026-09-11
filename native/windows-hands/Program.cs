using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Sexta.NativeHands
{
    internal sealed class Request
    {
        public string id { get; set; }
        public string action { get; set; }
        public Dictionary<string, object> payload { get; set; }
    }

    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        [STAThread]
        private static void Main()
        {
            Console.InputEncoding = new UTF8Encoding(false);
            Console.OutputEncoding = new UTF8Encoding(false);
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (string.IsNullOrWhiteSpace(line)) continue;
                var watch = Stopwatch.StartNew();
                var id = string.Empty;
                try
                {
                    var request = Json.Deserialize<Request>(line);
                    if (request == null) throw new InvalidOperationException("PC_HANDS_REQUEST_INVALID");
                    id = request.id ?? string.Empty;
                    var result = Dispatch((request.action ?? string.Empty).Trim(), request.payload ?? new Dictionary<string, object>());
                    Write(new Dictionary<string, object> { ["id"] = id, ["ok"] = true, ["result"] = result, ["durationMs"] = watch.ElapsedMilliseconds });
                }
                catch (Exception error)
                {
                    Write(new Dictionary<string, object> { ["id"] = id, ["ok"] = false, ["error"] = NormalizeError(error), ["durationMs"] = watch.ElapsedMilliseconds });
                }
            }
        }

        private static object Dispatch(string action, Dictionary<string, object> payload)
        {
            switch (action)
            {
                case "ping": return new { ready = true, version = "3.0.0", backend = "native-dotnet-uia-win32" };
                case "window_list": return WindowService.List(Int(payload, "limit", 30));
                case "window_focus": return WindowService.Focus(Str(payload, "title"), Long(payload, "hwnd"));
                case "window_state": return WindowService.State(Str(payload, "title"), Long(payload, "hwnd"), Str(payload, "state"));
                case "window_move_resize": return WindowService.MoveResize(Str(payload, "title"), Long(payload, "hwnd"), Int(payload, "x"), Int(payload, "y"), Math.Max(120, Int(payload, "width", 800)), Math.Max(80, Int(payload, "height", 600)));
                case "window_close": return WindowService.Close(Str(payload, "title"), Long(payload, "hwnd"));
                case "ui_tree": return UiService.Tree(Int(payload, "maxNodes", 120));
                case "ui_click_text": return UiService.ClickText(Str(payload, "text"));
                case "ui_type_text": return UiService.TypeText(Str(payload, "text"), Str(payload, "target"));
                case "ui_action": return UiService.Action(payload);
                case "screen_click_point":
                    if (!payload.ContainsKey("x") || !payload.ContainsKey("y")) throw new InvalidOperationException("PC_SCREEN_POINT_REQUIRED");
                    return UiService.ScreenClick(Int(payload, "x"), Int(payload, "y"), Str(payload, "label"));
                case "ui_scroll": return UiService.Scroll(Str(payload, "direction"), Str(payload, "amount"));
                case "ui_hotkey": return InputService.Hotkey(Str(payload, "shortcut"));
                case "screen_capture": return ScreenService.Capture(Str(payload, "scope"));
                default: throw new InvalidOperationException("PC_HANDS_ACTION_NOT_SUPPORTED");
            }
        }

        private static string Str(Dictionary<string, object> payload, string key, string fallback = "")
        {
            object value;
            return payload != null && payload.TryGetValue(key, out value) && value != null ? Convert.ToString(value) ?? fallback : fallback;
        }

        private static int Int(Dictionary<string, object> payload, string key, int fallback = 0)
        {
            object value;
            if (payload == null || !payload.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToInt32(value); } catch { return fallback; }
        }

        private static long Long(Dictionary<string, object> payload, string key, long fallback = 0)
        {
            object value;
            if (payload == null || !payload.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToInt64(value); } catch { return fallback; }
        }

        private static string NormalizeError(Exception error)
        {
            var message = (error == null ? string.Empty : error.Message) ?? string.Empty;
            if (Regex.IsMatch(message, "^PC_[A-Z0-9_]+$")) return message;
            if (message.IndexOf("Access is denied", StringComparison.OrdinalIgnoreCase) >= 0) return "PC_HANDS_ACCESS_DENIED";
            if (message.IndexOf("ElementNotAvailable", StringComparison.OrdinalIgnoreCase) >= 0) return "PC_UI_ELEMENT_GONE";
            var compact = message.Replace("\r", " ").Replace("\n", " ");
            if (compact.Length > 500) compact = compact.Substring(0, 500);
            return string.IsNullOrWhiteSpace(compact) ? "PC_HANDS_NATIVE_ERROR" : "PC_HANDS_NATIVE_ERROR:" + compact;
        }

        private static void Write(object value)
        {
            Console.WriteLine(Json.Serialize(value));
            Console.Out.Flush();
        }
    }
}
