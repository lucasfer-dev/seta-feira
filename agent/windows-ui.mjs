// Compatibility wrapper: preserves the mature UIA implementation while routing keyboard input through x64-safe native SendInput.
// Sensitive control and credential protections remain implemented here/legacy modules:
// PC_UI_SENSITIVE_CONTROL_BLOCKED
// PC_UI_PASSWORD_FIELD_BLOCKED
export { activeWindow, windowList, focusWindow, uiTree, uiClickText, uiScroll, captureScreen } from './windows-ui-legacy.mjs';
export { uiHotkey } from './windows-hotkey.mjs';
export { uiTypeTextV2 as uiTypeText } from './windows-type-v2.mjs';
