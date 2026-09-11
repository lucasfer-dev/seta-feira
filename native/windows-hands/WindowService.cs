using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Windows.Automation;

namespace Sexta.NativeHands
{
    internal sealed class WindowInfo
    {
        public long hwnd { get; set; }
        public int pid { get; set; }
        public string process { get; set; }
        public string title { get; set; }
        public bool active { get; set; }
        public bool visible { get; set; }
        public bool minimized { get; set; }
        public bool maximized { get; set; }
        public int x { get; set; }
        public int y { get; set; }
        public int width { get; set; }
        public int height { get; set; }
    }

    internal static class WindowService
    {
        internal static object List(int requestedLimit)
        {
            var limit = Math.Max(1, Math.Min(80, requestedLimit));
            var all = Enumerate()
                .OrderByDescending(w => w.active)
                .ThenByDescending(w => w.visible)
                .ThenBy(w => (w.title ?? string.Empty).Length)
                .Take(limit)
                .ToList();
            return new { windows = all, count = all.Count, active = all.FirstOrDefault(w => w.active), provider = "native-hands-v3" };
        }

        internal static object Focus(string title, long hwndValue)
        {
            var before = NativeMethods.GetForegroundWindow().ToInt64();
            var found = Find(title, hwndValue);
            var hwnd = new IntPtr(found.hwnd);
            var restored = NativeMethods.IsIconic(hwnd) || !NativeMethods.IsWindowVisible(hwnd);
            FocusHandle(hwnd);
            var after = NativeMethods.GetForegroundWindow().ToInt64();
            if (after != hwnd.ToInt64()) throw new InvalidOperationException("PC_WINDOW_FOCUS_NOT_VERIFIED");
            var now = Snapshot(hwnd);
            return new
            {
                ok = true, action = "focus", verified = true, restored,
                beforeHwnd = before, afterHwnd = after,
                now.hwnd, now.pid, now.process, now.title, now.visible, now.minimized, now.maximized,
                now.x, now.y, now.width, now.height,
                provider = "native-hands-v3"
            };
        }

        internal static object State(string title, long hwndValue, string state)
        {
            var desired = (state ?? string.Empty).Trim().ToLowerInvariant();
            if (desired != "restore" && desired != "minimize" && desired != "maximize")
                throw new InvalidOperationException("PC_WINDOW_STATE_INVALID");

            var found = Find(title, hwndValue);
            var hwnd = new IntPtr(found.hwnd);
            var cmd = desired == "minimize" ? NativeMethods.SW_MINIMIZE : desired == "maximize" ? NativeMethods.SW_MAXIMIZE : NativeMethods.SW_RESTORE;
            NativeMethods.ShowWindowAsync(hwnd, cmd);

            var watch = Stopwatch.StartNew();
            var verified = false;
            while (watch.ElapsedMilliseconds < 1800)
            {
                Thread.Sleep(45);
                var min = NativeMethods.IsIconic(hwnd);
                var max = NativeMethods.IsZoomed(hwnd);
                var vis = NativeMethods.IsWindowVisible(hwnd);
                verified = desired == "minimize" ? min : desired == "maximize" ? max : (!min && !max && vis);
                if (verified) break;
            }
            if (!verified) throw new InvalidOperationException("PC_WINDOW_STATE_NOT_VERIFIED");
            if (desired == "restore") { try { FocusHandle(hwnd); } catch { } }
            var now = Snapshot(hwnd);
            return new
            {
                ok = true, action = desired, verified = true,
                now.hwnd, now.pid, now.process, now.title, now.visible, now.minimized, now.maximized,
                now.x, now.y, now.width, now.height,
                provider = "native-hands-v3"
            };
        }

        internal static object MoveResize(string title, long hwndValue, int x, int y, int width, int height)
        {
            var found = Find(title, hwndValue);
            var hwnd = new IntPtr(found.hwnd);
            if (NativeMethods.IsIconic(hwnd) || NativeMethods.IsZoomed(hwnd))
            {
                NativeMethods.ShowWindowAsync(hwnd, NativeMethods.SW_RESTORE);
                Thread.Sleep(100);
            }
            if (!NativeMethods.SetWindowPos(hwnd, IntPtr.Zero, x, y, width, height,
                NativeMethods.SWP_NOZORDER | NativeMethods.SWP_NOACTIVATE | NativeMethods.SWP_SHOWWINDOW))
                throw new InvalidOperationException("PC_WINDOW_MOVE_FAILED");

            WindowInfo now = null;
            var verified = false;
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < 1600)
            {
                Thread.Sleep(40);
                now = Snapshot(hwnd);
                verified = Math.Abs(now.x - x) <= 4 && Math.Abs(now.y - y) <= 4 &&
                           Math.Abs(now.width - width) <= 10 && Math.Abs(now.height - height) <= 10;
                if (verified) break;
            }
            if (!verified) throw new InvalidOperationException("PC_WINDOW_MOVE_NOT_VERIFIED");
            return new { ok = true, action = "move_resize", verified = true, now.hwnd, now.pid, now.process, now.title, now.x, now.y, now.width, now.height, provider = "native-hands-v3" };
        }

        internal static object Close(string title, long hwndValue)
        {
            var found = Find(title, hwndValue);
            var hwnd = new IntPtr(found.hwnd);
            var watch = Stopwatch.StartNew();
            if (!NativeMethods.PostMessage(hwnd, NativeMethods.WM_CLOSE, IntPtr.Zero, IntPtr.Zero))
                throw new InvalidOperationException("PC_WINDOW_CLOSE_POST_FAILED");

            if (WaitGone(hwnd, 2200))
                return new { ok = true, action = "close", closed = true, verified = true, found.hwnd, found.title, via = "WM_CLOSE", durationMs = watch.ElapsedMilliseconds, provider = "native-hands-v3" };

            var via = "WM_CLOSE";
            try
            {
                var root = AutomationElement.FromHandle(hwnd);
                object raw;
                if (root != null && root.TryGetCurrentPattern(WindowPattern.Pattern, out raw))
                {
                    ((WindowPattern)raw).Close();
                    via = "WindowPattern.Close";
                }
            }
            catch { }

            if (!WaitGone(hwnd, 2200)) throw new InvalidOperationException("PC_WINDOW_CLOSE_NOT_VERIFIED");
            return new { ok = true, action = "close", closed = true, verified = true, found.hwnd, found.title, via, durationMs = watch.ElapsedMilliseconds, provider = "native-hands-v3" };
        }

        internal static WindowInfo Active()
        {
            var hwnd = NativeMethods.GetForegroundWindow();
            return hwnd == IntPtr.Zero ? null : Snapshot(hwnd);
        }

        internal static WindowInfo Find(string title, long hwndValue)
        {
            if (hwndValue > 0)
            {
                var exact = new IntPtr(hwndValue);
                if (NativeMethods.IsWindow(exact)) return Snapshot(exact);
            }
            var needle = (title ?? string.Empty).Trim();
            if (needle.Length == 0) throw new InvalidOperationException("PC_WINDOW_TITLE_REQUIRED");
            var ranked = Enumerate()
                .Select(w => new { window = w, score = Score(w, needle) })
                .Where(x => x.score < 999)
                .OrderBy(x => x.score)
                .ThenByDescending(x => x.window.active)
                .ThenByDescending(x => x.window.visible)
                .ThenBy(x => (x.window.title ?? string.Empty).Length)
                .FirstOrDefault();
            if (ranked == null) throw new InvalidOperationException("PC_WINDOW_NOT_FOUND");
            return ranked.window;
        }

        private static List<WindowInfo> Enumerate()
        {
            var list = new List<WindowInfo>();
            var active = NativeMethods.GetForegroundWindow();
            NativeMethods.EnumWindows((hwnd, _) =>
            {
                try
                {
                    if (!NativeMethods.IsWindow(hwnd)) return true;
                    var title = NativeMethods.Title(hwnd);
                    if (string.IsNullOrWhiteSpace(title)) return true;
                    list.Add(Snapshot(hwnd, active));
                }
                catch { }
                return true;
            }, IntPtr.Zero);
            return list;
        }

        private static WindowInfo Snapshot(IntPtr hwnd, IntPtr? activeOverride = null)
        {
            uint pid;
            NativeMethods.GetWindowThreadProcessId(hwnd, out pid);
            NativeMethods.RECT rect;
            NativeMethods.GetWindowRect(hwnd, out rect);
            var process = string.Empty;
            try { process = Process.GetProcessById((int)pid).ProcessName; } catch { }
            var active = activeOverride ?? NativeMethods.GetForegroundWindow();
            return new WindowInfo
            {
                hwnd = hwnd.ToInt64(), pid = (int)pid, process = process, title = NativeMethods.Title(hwnd),
                active = hwnd == active, visible = NativeMethods.IsWindowVisible(hwnd), minimized = NativeMethods.IsIconic(hwnd), maximized = NativeMethods.IsZoomed(hwnd),
                x = rect.Left, y = rect.Top, width = Math.Max(0, rect.Right - rect.Left), height = Math.Max(0, rect.Bottom - rect.Top)
            };
        }

        private static int Score(WindowInfo w, string needle)
        {
            var title = w.title ?? string.Empty;
            var process = w.process ?? string.Empty;
            if (title.Equals(needle, StringComparison.OrdinalIgnoreCase)) return 0;
            if (process.Equals(needle, StringComparison.OrdinalIgnoreCase)) return 1;
            if (title.StartsWith(needle, StringComparison.OrdinalIgnoreCase)) return 2;
            if (process.StartsWith(needle, StringComparison.OrdinalIgnoreCase)) return 3;
            if (title.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return 4;
            if (process.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) return 5;
            return 999;
        }

        private static void FocusHandle(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !NativeMethods.IsWindow(hwnd)) throw new InvalidOperationException("PC_WINDOW_NOT_FOUND");
            if (NativeMethods.IsIconic(hwnd) || !NativeMethods.IsWindowVisible(hwnd))
            {
                NativeMethods.ShowWindowAsync(hwnd, NativeMethods.SW_RESTORE);
                Thread.Sleep(80);
            }
            else NativeMethods.ShowWindowAsync(hwnd, NativeMethods.SW_SHOW);

            var currentThread = NativeMethods.GetCurrentThreadId();
            uint targetPid;
            var targetThread = NativeMethods.GetWindowThreadProcessId(hwnd, out targetPid);
            var foreground = NativeMethods.GetForegroundWindow();
            uint foregroundPid = 0;
            var foregroundThread = foreground == IntPtr.Zero ? 0 : NativeMethods.GetWindowThreadProcessId(foreground, out foregroundPid);
            var targetAttached = false;
            var foregroundAttached = false;
            try
            {
                if (targetThread != 0 && targetThread != currentThread) targetAttached = NativeMethods.AttachThreadInput(currentThread, targetThread, true);
                if (foregroundThread != 0 && foregroundThread != currentThread && foregroundThread != targetThread) foregroundAttached = NativeMethods.AttachThreadInput(currentThread, foregroundThread, true);
                NativeMethods.BringWindowToTop(hwnd);
                NativeMethods.SetForegroundWindow(hwnd);
                NativeMethods.SetFocus(hwnd);
            }
            finally
            {
                if (foregroundAttached) NativeMethods.AttachThreadInput(currentThread, foregroundThread, false);
                if (targetAttached) NativeMethods.AttachThreadInput(currentThread, targetThread, false);
            }
            if (WaitForeground(hwnd, 900)) return;

            NativeMethods.SetWindowPos(hwnd, NativeMethods.HWND_TOPMOST, 0, 0, 0, 0, NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_SHOWWINDOW);
            NativeMethods.SetWindowPos(hwnd, NativeMethods.HWND_NOTOPMOST, 0, 0, 0, 0, NativeMethods.SWP_NOMOVE | NativeMethods.SWP_NOSIZE | NativeMethods.SWP_SHOWWINDOW);
            NativeMethods.BringWindowToTop(hwnd);
            NativeMethods.SetForegroundWindow(hwnd);
            if (!WaitForeground(hwnd, 900)) throw new InvalidOperationException("PC_WINDOW_FOCUS_NOT_VERIFIED");
        }

        private static bool WaitForeground(IntPtr hwnd, int timeoutMs)
        {
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < timeoutMs)
            {
                if (NativeMethods.GetForegroundWindow() == hwnd) return true;
                Thread.Sleep(45);
            }
            return false;
        }

        private static bool WaitGone(IntPtr hwnd, int timeoutMs)
        {
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < timeoutMs)
            {
                if (!NativeMethods.IsWindow(hwnd)) return true;
                Thread.Sleep(60);
            }
            return !NativeMethods.IsWindow(hwnd);
        }
    }
}
