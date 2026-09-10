import * as legacy from './windows-control-v2-legacy.mjs';
import { windowList as processWindowList } from './windows-ui-legacy.mjs';
import { focusWindowRobust } from './windows-focus-v2.mjs';

// The legacy module owns EnumWindows, SetWindowPos and WM_CLOSE/PostMessage primitives.
// This wrapper replaces foreground acquisition with a stricter GetForegroundWindow / ShowWindowAsync /
// SetForegroundWindow / AttachThreadInput path plus ALT/topmost fallbacks and explicit privilege diagnostics.
// Error contracts preserved: PC_WINDOW_FOCUS_NOT_VERIFIED, PC_WINDOW_CLOSE_NOT_VERIFIED, PC_WINDOW_MOVE_NOT_VERIFIED.

export async function listWindows(limit = 30) {
  const requested = Math.max(1, Math.min(80, Number(limit) || 30));
  let primary = null;
  try { primary = await legacy.listWindows(requested); } catch {}
  if (Array.isArray(primary?.windows) && primary.windows.length) return { ...primary, provider: primary.provider || 'enumwindows' };

  const fallback = await processWindowList(Math.min(30, requested));
  const windows = Array.isArray(fallback?.windows) ? fallback.windows : [];
  return {
    windows,
    count: windows.length,
    active: fallback?.active || windows.find(win => win.active) || null,
    provider: 'process-main-window-fallback',
    primaryEmpty: true
  };
}

export const moveResizeWindow = legacy.moveResizeWindow;
export const closeWindowNative = legacy.closeWindowNative;

export async function focusWindowNative(title, hwnd = 0) {
  return focusWindowRobust(title, hwnd);
}

export async function setWindowState(title, state, hwnd = 0) {
  const desired = String(state || '').toLowerCase();
  if (desired === 'restore') {
    const focused = await focusWindowRobust(title, hwnd, { restoreNormal: true });
    if (focused.minimized || focused.maximized) throw new Error('PC_WINDOW_STATE_NOT_VERIFIED');
    return { ...focused, action: 'restore', verified: true };
  }
  return legacy.setWindowState(title, desired, hwnd);
}
