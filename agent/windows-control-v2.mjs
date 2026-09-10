import * as fallback from './windows-control-v2-fallback.mjs';
import { isNativeHandsUnavailable, nativeHandsRequest } from './windows-hands-native.mjs';

async function preferNative(action, payload, legacy) {
  try {
    return await nativeHandsRequest(action, payload, { timeoutMs: action === 'window_close' ? 6500 : 4500 });
  } catch (error) {
    if (!isNativeHandsUnavailable(error)) throw error;
    return legacy();
  }
}

export async function listWindows(limit = 30) {
  const max = Math.max(1, Math.min(80, Number(limit) || 30));
  return preferNative('window_list', { limit: max }, () => fallback.listWindows(max));
}

export async function focusWindowNative(title, hwnd = 0) {
  const target = String(title || '').trim().slice(0, 240);
  const handle = Number(hwnd) || 0;
  return preferNative('window_focus', { title: target, hwnd: handle }, () => fallback.focusWindowNative(target, handle));
}

export async function setWindowState(title, state, hwnd = 0) {
  const target = String(title || '').trim().slice(0, 240);
  const desired = String(state || '').trim().toLowerCase();
  const handle = Number(hwnd) || 0;
  return preferNative('window_state', { title: target, state: desired, hwnd: handle }, () => fallback.setWindowState(target, desired, handle));
}

export async function moveResizeWindow(title, options = {}) {
  const target = String(title || '').trim().slice(0, 240);
  const payload = {
    title: target,
    hwnd: Number(options.hwnd) || 0,
    x: Math.round(Number(options.x) || 0),
    y: Math.round(Number(options.y) || 0),
    width: Math.max(120, Math.round(Number(options.width) || 800)),
    height: Math.max(80, Math.round(Number(options.height) || 600))
  };
  return preferNative('window_move_resize', payload, () => fallback.moveResizeWindow(target, payload));
}

export async function closeWindowNative(title, hwnd = 0) {
  const target = String(title || '').trim().slice(0, 240);
  const handle = Number(hwnd) || 0;
  return preferNative('window_close', { title: target, hwnd: handle }, () => fallback.closeWindowNative(target, handle));
}
