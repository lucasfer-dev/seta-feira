// Compatibility wrapper: preserves the mature UIA implementation while routing hotkeys through native SendInput.
// Sensitive control and credential protections remain implemented in windows-ui-legacy.mjs:
// PC_UI_SENSITIVE_CONTROL_BLOCKED
// PC_UI_PASSWORD_FIELD_BLOCKED
export { activeWindow, windowList, focusWindow, uiTree, uiClickText, uiTypeText, uiScroll, captureScreen } from './windows-ui-legacy.mjs';
export { uiHotkey } from './windows-hotkey.mjs';
