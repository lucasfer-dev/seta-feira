import * as fallback from './windows-ui-actions-legacy.mjs';
import { isNativeHandsUnavailable, nativeHandsRequest } from './windows-hands-native.mjs';

async function preferNative(action, payload, legacy, timeoutMs = 6000) {
  try {
    return await nativeHandsRequest(action, payload, { timeoutMs });
  } catch (error) {
    if (!isNativeHandsUnavailable(error)) throw error;
    return legacy();
  }
}

export async function uiAction(options = {}) {
  const payload = {
    action: String(options.action || 'invoke').slice(0, 40),
    name: String(options.name || '').slice(0, 240),
    automationId: String(options.automationId || '').slice(0, 240),
    controlType: String(options.controlType || '').slice(0, 120),
    value: String(options.value ?? '').slice(0, 4000)
  };
  return preferNative('ui_action', payload, () => fallback.uiAction(payload), 6500);
}

export async function clickScreenPoint(options = {}) {
  const payload = {
    x: Math.round(Number(options.x)),
    y: Math.round(Number(options.y)),
    label: String(options.label || '').slice(0, 240)
  };
  return preferNative('screen_click_point', payload, () => fallback.clickScreenPoint(payload), 4500);
}
