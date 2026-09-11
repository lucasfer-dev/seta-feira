using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Windows.Automation;

namespace Sexta.NativeHands
{
    internal static class UiService
    {
        internal static object Tree(int requestedMax)
        {
            var max = Math.Max(20, Math.Min(220, requestedMax));
            var root = ActiveRoot();
            var nodes = new List<Dictionary<string, object>>();
            var queue = new Queue<Tuple<AutomationElement, int>>();
            queue.Enqueue(Tuple.Create(root, 0));
            var walker = TreeWalker.ControlViewWalker;
            var enumerated = 0;

            while (queue.Count > 0 && nodes.Count < max && enumerated < 4000)
            {
                var item = queue.Dequeue();
                var node = item.Item1;
                var depth = item.Item2;
                enumerated++;
                Dictionary<string, object> info;
                if (TryInfo(node, depth, nodes.Count, out info)) nodes.Add(info);
                try
                {
                    var child = walker.GetFirstChild(node);
                    var guard = 0;
                    while (child != null && guard++ < 300)
                    {
                        queue.Enqueue(Tuple.Create(child, depth + 1));
                        child = walker.GetNextSibling(child);
                    }
                }
                catch { }
            }

            var hwnd = NativeMethods.GetForegroundWindow();
            return new { window = NativeMethods.Title(hwnd), count = nodes.Count, enumerated, nodes, provider = "native-uia-v3", hwnd = hwnd.ToInt64() };
        }

        internal static object ClickText(string text)
        {
            var target = (text ?? string.Empty).Trim();
            if (target.Length == 0) throw new InvalidOperationException("PC_UI_TEXT_REQUIRED");
            if (Safety.IsSensitive(target) || Safety.IsCredential(target)) throw new InvalidOperationException("PC_UI_SENSITIVE_CONTROL_BLOCKED");
            var node = Find(ActiveRoot(), target, string.Empty, string.Empty);
            var summary = Summary(node);
            var click = InvokeOrClick(node);
            return new { ok = true, clicked = true, verified = click.Item2, requiresObservation = click.Item3, via = click.Item1, target = summary, hwnd = NativeMethods.GetForegroundWindow().ToInt64(), provider = "native-uia-v3" };
        }

        internal static object TypeText(string text, string target)
        {
            var value = text ?? string.Empty;
            if (value.Length > 4000) value = value.Substring(0, 4000);
            AutomationElement node;
            if (!string.IsNullOrWhiteSpace(target))
            {
                if (Safety.IsCredential(target)) throw new InvalidOperationException("PC_UI_PASSWORD_FIELD_BLOCKED");
                node = FindWritable(ActiveRoot(), target.Trim());
            }
            else node = AutomationElement.FocusedElement;
            if (node == null) throw new InvalidOperationException("PC_UI_CONTROL_NOT_FOUND");
            if (SafeBool(() => node.Current.IsPassword)) throw new InvalidOperationException("PC_UI_PASSWORD_FIELD_BLOCKED");
            var summary = Summary(node);
            var write = SetValue(node, value, false);
            if (!write.Item2) throw new InvalidOperationException("PC_UI_ACTION_NOT_VERIFIED");
            return new { ok = true, typed = true, verified = true, via = write.Item1, target = summary, provider = "native-uia-v3" };
        }

        internal static object Action(Dictionary<string, object> payload)
        {
            var op = NormalizeOperation(Get(payload, "action", "invoke"));
            var name = Get(payload, "name").Trim();
            var id = Get(payload, "automationId").Trim();
            var type = Get(payload, "controlType").Trim();
            var value = Get(payload, "value");
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "invoke", "click", "double_click", "right_click", "focus",
                "select", "add_to_selection", "remove_from_selection", "toggle",
                "expand", "collapse", "set_value", "type", "scroll_into_view",
                "set_range", "increment", "decrement"
            };
            if (!allowed.Contains(op)) throw new InvalidOperationException("PC_UI_ACTION_NOT_ALLOWED");
            if (name.Length == 0 && id.Length == 0 && type.Length == 0) throw new InvalidOperationException("PC_UI_SELECTOR_REQUIRED");

            var writeLike = op == "set_value" || op == "type";
            if (writeLike && (Safety.IsCredential(name) || Safety.IsCredential(id))) throw new InvalidOperationException("PC_UI_PASSWORD_FIELD_BLOCKED");
            if (!writeLike && (Safety.IsSensitive(name) || Safety.IsSensitive(id))) throw new InvalidOperationException("PC_UI_SENSITIVE_CONTROL_BLOCKED");

            var node = Find(ActiveRoot(), name, id, type);
            if (SafeBool(() => node.Current.IsPassword) && writeLike) throw new InvalidOperationException("PC_UI_PASSWORD_FIELD_BLOCKED");

            var selectedName = SafeString(() => node.Current.Name);
            var selectedId = SafeString(() => node.Current.AutomationId);
            var selectedType = SafeString(() => node.Current.ControlType.ProgrammaticName);
            string via;
            bool verified;
            bool requiresObservation = false;
            object raw;

            switch (op)
            {
                case "focus":
                    node.SetFocus();
                    System.Threading.Thread.Sleep(60);
                    via = "SetFocus";
                    verified = SafeBool(() => node.Current.HasKeyboardFocus, true);
                    break;

                case "select":
                    if (!node.TryGetCurrentPattern(SelectionItemPattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var selection = (SelectionItemPattern)raw;
                    var menuSelection = Safe(() => node.Current.ControlType == ControlType.MenuItem, false);
                    selection.Select();
                    System.Threading.Thread.Sleep(65);
                    via = "SelectionItem";
                    verified = menuSelection || SafeBool(() => selection.Current.IsSelected, false);
                    requiresObservation = menuSelection;
                    break;

                case "add_to_selection":
                    if (!node.TryGetCurrentPattern(SelectionItemPattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var addSelection = (SelectionItemPattern)raw;
                    addSelection.AddToSelection();
                    System.Threading.Thread.Sleep(50);
                    via = "SelectionItem.AddToSelection";
                    verified = SafeBool(() => addSelection.Current.IsSelected, true);
                    break;

                case "remove_from_selection":
                    if (!node.TryGetCurrentPattern(SelectionItemPattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var removeSelection = (SelectionItemPattern)raw;
                    removeSelection.RemoveFromSelection();
                    System.Threading.Thread.Sleep(50);
                    via = "SelectionItem.RemoveFromSelection";
                    verified = !SafeBool(() => removeSelection.Current.IsSelected, false);
                    break;

                case "toggle":
                    if (!node.TryGetCurrentPattern(TogglePattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var toggle = (TogglePattern)raw;
                    var beforeToggle = toggle.Current.ToggleState;
                    toggle.Toggle();
                    System.Threading.Thread.Sleep(50);
                    via = "Toggle";
                    verified = SafeBool(() => toggle.Current.ToggleState != beforeToggle, true);
                    break;

                case "expand":
                case "collapse":
                    if (!node.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var expander = (ExpandCollapsePattern)raw;
                    if (op == "expand") expander.Expand(); else expander.Collapse();
                    System.Threading.Thread.Sleep(60);
                    var state = Safe(() => expander.Current.ExpandCollapseState, ExpandCollapseState.LeafNode);
                    via = "ExpandCollapse";
                    verified = op == "expand"
                        ? state == ExpandCollapseState.Expanded || state == ExpandCollapseState.PartiallyExpanded
                        : state == ExpandCollapseState.Collapsed;
                    break;

                case "scroll_into_view":
                    if (!node.TryGetCurrentPattern(ScrollItemPattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    ((ScrollItemPattern)raw).ScrollIntoView();
                    System.Threading.Thread.Sleep(60);
                    via = "ScrollItem";
                    verified = !SafeBool(() => node.Current.IsOffscreen);
                    break;

                case "set_range":
                case "increment":
                case "decrement":
                    if (!node.TryGetCurrentPattern(RangeValuePattern.Pattern, out raw)) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var range = (RangeValuePattern)raw;
                    if (range.Current.IsReadOnly) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                    var beforeRange = range.Current.Value;
                    var desired = beforeRange;
                    if (op == "set_range")
                    {
                        if (!TryDouble(value, out desired)) throw new InvalidOperationException("PC_UI_RANGE_VALUE_REQUIRED");
                    }
                    else
                    {
                        var step = range.Current.SmallChange;
                        if (step <= 0 || double.IsNaN(step) || double.IsInfinity(step)) step = Math.Max(1.0, (range.Current.Maximum - range.Current.Minimum) / 20.0);
                        desired = op == "increment" ? beforeRange + step : beforeRange - step;
                    }
                    desired = Math.Max(range.Current.Minimum, Math.Min(range.Current.Maximum, desired));
                    range.SetValue(desired);
                    System.Threading.Thread.Sleep(65);
                    var afterRange = Safe(() => range.Current.Value, beforeRange);
                    via = "RangeValue";
                    verified = Math.Abs(afterRange - desired) <= Math.Max(0.001, Math.Abs(desired) * 0.001);
                    break;

                case "right_click":
                case "double_click":
                    var pointer = PointerAction(node, op);
                    via = pointer.Item1;
                    verified = pointer.Item2;
                    requiresObservation = true;
                    break;

                case "set_value":
                case "type":
                    var write = SetValue(node, value, op == "type");
                    via = write.Item1;
                    verified = write.Item2;
                    break;

                default:
                    var click = InvokeOrClick(node);
                    via = click.Item1;
                    verified = click.Item2;
                    requiresObservation = click.Item3;
                    break;
            }

            if (writeLike && !verified) throw new InvalidOperationException("PC_UI_ACTION_NOT_VERIFIED");
            return new
            {
                ok = true,
                action = op,
                verified,
                requiresObservation,
                via,
                name = selectedName,
                automationId = selectedId,
                controlType = selectedType,
                hwnd = NativeMethods.GetForegroundWindow().ToInt64(),
                provider = "native-uia-v3"
            };
        }

        internal static object Scroll(string direction, string amount)
        {
            var dir = string.Equals(direction, "up", StringComparison.OrdinalIgnoreCase) ? "up" : "down";
            var small = string.Equals(amount, "small", StringComparison.OrdinalIgnoreCase);
            var increment = dir == "up"
                ? (small ? ScrollAmount.SmallDecrement : ScrollAmount.LargeDecrement)
                : (small ? ScrollAmount.SmallIncrement : ScrollAmount.LargeIncrement);
            var root = ActiveRoot();
            var all = root.FindAll(TreeScope.Subtree, Condition.TrueCondition);
            ScrollPattern pattern = null;
            AutomationElement owner = null;

            for (var i = 0; i < all.Count && i < 1600; i++)
            {
                try
                {
                    object raw;
                    if (!all[i].TryGetCurrentPattern(ScrollPattern.Pattern, out raw)) continue;
                    var candidate = (ScrollPattern)raw;
                    if (!candidate.Current.VerticallyScrollable) continue;
                    pattern = candidate;
                    owner = all[i];
                    break;
                }
                catch { }
            }

            if (pattern != null)
            {
                var before = Safe(() => pattern.Current.VerticalScrollPercent, -1.0);
                pattern.ScrollVertical(increment);
                System.Threading.Thread.Sleep(70);
                var after = Safe(() => pattern.Current.VerticalScrollPercent, before);
                return new { ok = true, scrolled = true, verified = before < 0 || after != before, requiresObservation = false, direction = dir, amount = small ? "small" : "large", before, after, target = owner == null ? null : Summary(owner), via = "ScrollPattern", provider = "native-uia-v3" };
            }

            // Canvas, Chromium custom surfaces, Electron and games nem sempre expõem ScrollPattern.
            // O fallback continua nativo e usa a roda do mouse no centro da janela ativa.
            var rect = Safe(() => root.Current.BoundingRectangle, System.Windows.Rect.Empty);
            if (!rect.IsEmpty && rect.Width > 4 && rect.Height > 4)
            {
                NativeMethods.SetCursorPos((int)Math.Round(rect.X + rect.Width / 2), (int)Math.Round(rect.Y + rect.Height / 2));
            }
            var delta = dir == "up" ? (small ? 120 : 480) : (small ? -120 : -480);
            InputService.Wheel(delta);
            System.Threading.Thread.Sleep(70);
            return new { ok = true, scrolled = true, verified = true, requiresObservation = true, direction = dir, amount = small ? "small" : "large", before = -1.0, after = -1.0, target = Summary(root), via = "native-mouse-wheel", provider = "native-hands-v3" };
        }

        internal static object ScreenClick(int x, int y, string label)
        {
            var target = (label ?? string.Empty).Trim();
            if (target.Length == 0) throw new InvalidOperationException("PC_SCREEN_POINT_LABEL_REQUIRED");
            if (Safety.IsSensitive(target) || Safety.IsCredential(target)) throw new InvalidOperationException("PC_UI_SENSITIVE_CONTROL_BLOCKED");
            var before = NativeMethods.GetForegroundWindow().ToInt64();
            InputService.Click(x, y);
            System.Threading.Thread.Sleep(80);
            return new { ok = true, clicked = true, verified = true, requiresObservation = true, x, y, label = target, beforeHwnd = before, afterHwnd = NativeMethods.GetForegroundWindow().ToInt64(), via = "native-mouse", provider = "native-hands-v3" };
        }

        private static AutomationElement ActiveRoot()
        {
            var hwnd = NativeMethods.GetForegroundWindow();
            if (hwnd == IntPtr.Zero) throw new InvalidOperationException("PC_UI_NO_FOREGROUND_WINDOW");
            var root = AutomationElement.FromHandle(hwnd);
            if (root == null) throw new InvalidOperationException("PC_UI_ROOT_UNAVAILABLE");
            return root;
        }

        private static AutomationElement Find(AutomationElement root, string name, string id, string type)
        {
            var all = root.FindAll(TreeScope.Subtree, Condition.TrueCondition);
            AutomationElement best = null;
            var bestScore = int.MaxValue;

            for (var i = 0; i < all.Count && i < 2200; i++)
            {
                try
                {
                    var el = all[i];
                    if (!el.Current.IsEnabled) continue;
                    var password = el.Current.IsPassword;
                    var currentName = password ? "[password]" : (el.Current.Name ?? string.Empty).Trim();
                    var currentId = (el.Current.AutomationId ?? string.Empty).Trim();
                    var fullType = el.Current.ControlType == null ? string.Empty : el.Current.ControlType.ProgrammaticName ?? string.Empty;
                    var shortType = fullType.Replace("ControlType.", string.Empty).Trim();
                    var score = 1000;

                    if (!string.IsNullOrWhiteSpace(id))
                    {
                        if (!currentId.Equals(id, StringComparison.OrdinalIgnoreCase)) continue;
                        score = 0;
                    }
                    else if (!string.IsNullOrWhiteSpace(name))
                    {
                        if (currentName.Equals(name, StringComparison.OrdinalIgnoreCase)) score = 1;
                        else if (currentName.StartsWith(name, StringComparison.OrdinalIgnoreCase)) score = 3;
                        else if (currentName.IndexOf(name, StringComparison.OrdinalIgnoreCase) >= 0) score = 5;
                        else continue;
                    }
                    else score = 10;

                    if (!string.IsNullOrWhiteSpace(type))
                    {
                        if (!shortType.Equals(type, StringComparison.OrdinalIgnoreCase) && !fullType.Equals(type, StringComparison.OrdinalIgnoreCase)) continue;
                        score -= 2;
                    }

                    if (el.Current.IsOffscreen) score += 60;
                    if (el.Current.ControlType == ControlType.Text) score += 20;
                    if (el.Current.ControlType == ControlType.Button || el.Current.ControlType == ControlType.MenuItem || el.Current.ControlType == ControlType.TabItem || el.Current.ControlType == ControlType.ListItem || el.Current.ControlType == ControlType.Hyperlink || el.Current.ControlType == ControlType.Edit) score -= 3;
                    if (el.Current.IsKeyboardFocusable) score -= 1;

                    if (score < bestScore)
                    {
                        best = el;
                        bestScore = score;
                    }
                }
                catch { }
            }

            if (best == null) throw new InvalidOperationException("PC_UI_CONTROL_NOT_FOUND");
            return best;
        }

        private static AutomationElement FindWritable(AutomationElement root, string selector)
        {
            var all = root.FindAll(TreeScope.Subtree, Condition.TrueCondition);
            AutomationElement best = null;
            var bestScore = int.MaxValue;

            for (var i = 0; i < all.Count && i < 2200; i++)
            {
                try
                {
                    var el = all[i];
                    if (!el.Current.IsEnabled) continue;
                    var password = el.Current.IsPassword;
                    var currentName = password ? "[password]" : (el.Current.Name ?? string.Empty).Trim();
                    var currentId = (el.Current.AutomationId ?? string.Empty).Trim();

                    var score = 1000;
                    if (currentId.Equals(selector, StringComparison.OrdinalIgnoreCase)) score = 0;
                    else if (currentName.Equals(selector, StringComparison.OrdinalIgnoreCase)) score = 10;
                    else if (currentName.StartsWith(selector, StringComparison.OrdinalIgnoreCase)) score = 20;
                    else if (currentName.IndexOf(selector, StringComparison.OrdinalIgnoreCase) >= 0) score = 30;
                    else continue;

                    object raw;
                    var writableValue = false;
                    try
                    {
                        if (el.TryGetCurrentPattern(ValuePattern.Pattern, out raw)) writableValue = !((ValuePattern)raw).Current.IsReadOnly;
                    }
                    catch { }

                    var isEdit = el.Current.ControlType == ControlType.Edit;
                    var keyboardFocusable = el.Current.IsKeyboardFocusable;
                    if (isEdit) score -= 8;
                    if (writableValue) score -= 6;
                    if (keyboardFocusable) score -= 2;
                    if (el.Current.IsOffscreen) score += 50;

                    if (score < bestScore)
                    {
                        best = el;
                        bestScore = score;
                    }
                }
                catch { }
            }

            if (best == null) throw new InvalidOperationException("PC_UI_CONTROL_NOT_FOUND");
            return best;
        }

        private static Tuple<string, bool, bool> InvokeOrClick(AutomationElement node)
        {
            if (SafeBool(() => node.Current.IsPassword)) throw new InvalidOperationException("PC_UI_PASSWORD_FIELD_BLOCKED");
            var semantic = SafeString(() => node.Current.Name) + " " + SafeString(() => node.Current.AutomationId);
            if (Safety.IsSensitive(semantic) || Safety.IsCredential(semantic)) throw new InvalidOperationException("PC_UI_SENSITIVE_CONTROL_BLOCKED");
            object raw;

            try
            {
                if (node.TryGetCurrentPattern(InvokePattern.Pattern, out raw))
                {
                    ((InvokePattern)raw).Invoke();
                    return Tuple.Create("Invoke", true, true);
                }
            }
            catch { }

            try
            {
                if (node.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out raw))
                {
                    var p = (ExpandCollapsePattern)raw;
                    var before = p.Current.ExpandCollapseState;
                    if (before != ExpandCollapseState.LeafNode)
                    {
                        if (before == ExpandCollapseState.Collapsed) p.Expand(); else p.Collapse();
                        System.Threading.Thread.Sleep(50);
                        var after = Safe(() => p.Current.ExpandCollapseState, before);
                        return Tuple.Create("ExpandCollapse", after != before, false);
                    }
                }
            }
            catch { }

            try
            {
                if (node.TryGetCurrentPattern(SelectionItemPattern.Pattern, out raw))
                {
                    var p = (SelectionItemPattern)raw;
                    var isMenuItem = Safe(() => node.Current.ControlType == ControlType.MenuItem, false);
                    p.Select();
                    System.Threading.Thread.Sleep(55);
                    if (isMenuItem) return Tuple.Create("SelectionItem", true, true);
                    return Tuple.Create("SelectionItem", SafeBool(() => p.Current.IsSelected, false), false);
                }
            }
            catch { }

            try
            {
                if (node.TryGetCurrentPattern(TogglePattern.Pattern, out raw))
                {
                    var p = (TogglePattern)raw;
                    var before = p.Current.ToggleState;
                    p.Toggle();
                    System.Threading.Thread.Sleep(45);
                    return Tuple.Create("Toggle", SafeBool(() => p.Current.ToggleState != before, true), false);
                }
            }
            catch { }

            try
            {
                System.Windows.Point point;
                if (node.TryGetClickablePoint(out point))
                {
                    InputService.Click((int)Math.Round(point.X), (int)Math.Round(point.Y));
                    return Tuple.Create("ClickablePoint", true, true);
                }
            }
            catch { }

            try
            {
                var rect = node.Current.BoundingRectangle;
                if (rect.Width > 1 && rect.Height > 1)
                {
                    InputService.Click((int)Math.Round(rect.X + rect.Width / 2), (int)Math.Round(rect.Y + rect.Height / 2));
                    return Tuple.Create("BoundingRectangle", true, true);
                }
            }
            catch { }

            throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
        }

        private static Tuple<string, bool> PointerAction(AutomationElement node, string op)
        {
            System.Windows.Point point;
            var hasPoint = false;
            try { hasPoint = node.TryGetClickablePoint(out point); }
            catch { point = new System.Windows.Point(); }

            if (!hasPoint)
            {
                var rect = Safe(() => node.Current.BoundingRectangle, System.Windows.Rect.Empty);
                if (rect.IsEmpty || rect.Width <= 1 || rect.Height <= 1) throw new InvalidOperationException("PC_UI_ACTION_UNSUPPORTED");
                point = new System.Windows.Point(rect.X + rect.Width / 2, rect.Y + rect.Height / 2);
            }

            var x = (int)Math.Round(point.X);
            var y = (int)Math.Round(point.Y);
            if (op == "right_click") InputService.RightClick(x, y); else InputService.DoubleClick(x, y);
            System.Threading.Thread.Sleep(70);
            return Tuple.Create(op == "right_click" ? "native-right-click" : "native-double-click", true);
        }

        private static Tuple<string, bool> SetValue(AutomationElement node, string value, bool forceKeyboard)
        {
            if (!forceKeyboard)
            {
                try
                {
                    object raw;
                    if (node.TryGetCurrentPattern(ValuePattern.Pattern, out raw))
                    {
                        var pattern = (ValuePattern)raw;
                        if (!pattern.Current.IsReadOnly)
                        {
                            pattern.SetValue(value);
                            var watch = Stopwatch.StartNew();
                            while (watch.ElapsedMilliseconds < 500)
                            {
                                if (string.Equals(pattern.Current.Value, value, StringComparison.Ordinal)) return Tuple.Create("ValuePattern", true);
                                System.Threading.Thread.Sleep(35);
                            }
                            return Tuple.Create("ValuePattern", false);
                        }
                    }
                }
                catch { }
            }

            try
            {
                node.SetFocus();
                System.Threading.Thread.Sleep(50);
                if (!InputService.CtrlA() || !InputService.Unicode(value)) return Tuple.Create("native-keyboard", false);
                return Tuple.Create("native-keyboard", true);
            }
            catch { return Tuple.Create("native-keyboard", false); }
        }

        private static Dictionary<string, object> Summary(AutomationElement node)
        {
            return new Dictionary<string, object>
            {
                ["name"] = SafeBool(() => node.Current.IsPassword) ? "[password]" : SafeString(() => node.Current.Name),
                ["automationId"] = SafeString(() => node.Current.AutomationId),
                ["controlType"] = SafeString(() => node.Current.ControlType.ProgrammaticName),
                ["enabled"] = SafeBool(() => node.Current.IsEnabled),
                ["focused"] = SafeBool(() => node.Current.HasKeyboardFocus),
                ["password"] = SafeBool(() => node.Current.IsPassword),
                ["offscreen"] = SafeBool(() => node.Current.IsOffscreen)
            };
        }

        private static bool TryInfo(AutomationElement node, int depth, int index, out Dictionary<string, object> info)
        {
            info = null;
            try
            {
                var password = node.Current.IsPassword;
                var rect = node.Current.BoundingRectangle;
                info = new Dictionary<string, object>
                {
                    ["index"] = index,
                    ["depth"] = depth,
                    ["name"] = password ? "[password]" : node.Current.Name ?? string.Empty,
                    ["automationId"] = node.Current.AutomationId ?? string.Empty,
                    ["controlType"] = node.Current.ControlType == null ? string.Empty : node.Current.ControlType.ProgrammaticName ?? string.Empty,
                    ["enabled"] = node.Current.IsEnabled,
                    ["focused"] = node.Current.HasKeyboardFocus,
                    ["password"] = password,
                    ["offscreen"] = node.Current.IsOffscreen,
                    ["x"] = (int)Math.Round(rect.X),
                    ["y"] = (int)Math.Round(rect.Y),
                    ["width"] = (int)Math.Round(rect.Width),
                    ["height"] = (int)Math.Round(rect.Height)
                };
                return true;
            }
            catch { return false; }
        }

        private static string NormalizeOperation(string value)
        {
            var op = (value ?? string.Empty).Trim().ToLowerInvariant().Replace('-', '_').Replace(' ', '_');
            if (op == "activate" || op == "open") return "invoke";
            if (op == "doubleclick") return "double_click";
            if (op == "rightclick" || op == "context_menu") return "right_click";
            if (op == "increase") return "increment";
            if (op == "decrease") return "decrement";
            return op;
        }

        private static bool TryDouble(string value, out double result)
        {
            if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out result)) return true;
            return double.TryParse(value, NumberStyles.Float, CultureInfo.CurrentCulture, out result);
        }

        private static string Get(Dictionary<string, object> payload, string key, string fallback = "")
        {
            object value;
            return payload != null && payload.TryGetValue(key, out value) && value != null ? Convert.ToString(value) ?? fallback : fallback;
        }

        private static T Safe<T>(Func<T> action, T fallback) { try { return action(); } catch { return fallback; } }
        private static bool SafeBool(Func<bool> action, bool fallback = false) { try { return action(); } catch { return fallback; } }
        private static string SafeString(Func<string> action) { try { return action() ?? string.Empty; } catch { return string.Empty; } }
    }
}
