import * as legacy from './windows-control-v2-legacy.mjs';
import { focusWindowRobust } from './windows-focus-v2.mjs';

// The legacy module owns EnumWindows, SetWindowPos and WM_CLOSE/PostMessage primitives.
// This wrapper replaces foreground acquisition with a stricter GetForegroundWindow / ShowWindowAsync /
// SetForegroundWindow / AttachThreadInput path plus ALT/topmost fallbacks and explicit privilege diagnostics.
// Error contracts preserved: PC_WINDOW_FOCUS_NOT_VERIFIED, PC_WINDOW_CLOSE_NOT_VERIFIED, PC_WINDOW_MOVE_NOT_VERIFIED.

export const listWindows = legacy.listWindows;
export const moveResizeWindow = legacy.moveResizeWindow;
export const closeWindowNative = legacy.closeWindowNative;

export async function focusWindowNative(title, hwnd = 0) {
  return focusWindowRobust(title, hwnd);
}

export async function setWindowState(title, state, hwnd = 0) {
  const desired = String(state || '').toLowerCase();
  if (desired === 'restore') {
    const focused = await focusWindowRobust(title, hwnd, { restoreNormal: true });
    return {
      ...focused,
      action: 'restore',
      verified: focused.verified === true && focused.minimized === false && focused.maximized === false
    };
  }
  return legacy.setWindowState(title, desired, hwnd);
}
