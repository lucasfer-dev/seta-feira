import * as fallback from './windows-ui-legacy.mjs';
import { uiHotkey as fallbackHotkey } from './windows-hotkey.mjs';
import { uiTypeTextV2 as fallbackTypeText } from './windows-type-v2.mjs';
import { isNativeHandsUnavailable, nativeHandsRequest } from './windows-hands-native.mjs';

async function preferNative(action, payload, legacy, timeoutMs = 5000) {
  try {
    return await nativeHandsRequest(action, payload, { timeoutMs });
  } catch (error) {
    if (!isNativeHandsUnavailable(error)) throw error;
    return legacy();
  }
}

export async function activeWindow() {
  const state = await listWindows(80);
  return state.active || state.windows?.find(window => window.active) || null;
}

export async function windowList(limit = 30) {
  return listWindows(limit);
}

export async function listWindows(limit = 30) {
  const max = Math.max(1, Math.min(80, Number(limit) || 30));
  return preferNative('window_list', { limit: max }, () => fallback.windowList(max));
}

export async function focusWindow(title) {
  const target = String(title || '').trim().slice(0, 240);
  return preferNative('window_focus', { title: target, hwnd: 0 }, () => fallback.focusWindow(target));
}

export async function uiTree(maxNodes = 120) {
  const max = Math.max(20, Math.min(220, Number(maxNodes) || 120));
  return preferNative('ui_tree', { maxNodes: max }, () => fallback.uiTree(max), 6500);
}

export async function uiClickText(text) {
  const target = String(text || '').trim().slice(0, 240);
  return preferNative('ui_click_text', { text: target }, () => fallback.uiClickText(target), 5500);
}

export async function uiTypeText(text, target = '') {
  const value = String(text ?? '').slice(0, 4000);
  const selector = String(target || '').trim().slice(0, 240);
  return preferNative('ui_type_text', { text: value, target: selector }, () => fallbackTypeText(value, selector), 5500);
}

export async function uiScroll(direction = 'down', amount = 'large') {
  const dir = direction === 'up' ? 'up' : 'down';
  const size = amount === 'small' ? 'small' : 'large';
  return preferNative('ui_scroll', { direction: dir, amount: size }, () => fallback.uiScroll(dir, size), 5000);
}

export async function uiHotkey(shortcut) {
  const value = String(shortcut || '').trim().slice(0, 80);
  return preferNative('ui_hotkey', { shortcut: value }, () => fallbackHotkey(value), 4000);
}

export async function captureScreen(scope = 'primary') {
  const normalized = scope === 'all' ? 'all' : 'primary';
  return preferNative('screen_capture', { scope: normalized }, () => fallback.captureScreen(normalized), 8000);
}
