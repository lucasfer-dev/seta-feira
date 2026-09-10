import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_PROTOCOL_VERSION = '4.2.0';
const STATE_PATH = process.env.SEXTA_AGENT_STATE || fileURLToPath(new URL('./runtime-state.json', import.meta.url));

const DEFAULTS = Object.freeze({
  version: AGENT_PROTOCOL_VERSION,
  paused: false,
  autonomy: 'assistant',
  privacy: {
    screen: true,
    clipboard: true,
    uiAutomation: true,
    browser: true,
    hardware: true
  },
  cancelEpoch: 0,
  updatedAt: ''
});

const CONTROL_ACTIONS = new Set(['agent_control']);
const OBSERVER_ACTIONS = new Set([
  'git_status', 'get_system_info', 'hardware_status', 'read_clipboard', 'window_list', 'ui_tree',
  'screen_analyze', 'browser_tabs', 'browser_snapshot'
]);

function cleanState(raw = {}) {
  const autonomy = ['observer', 'assistant', 'autonomous'].includes(raw.autonomy) ? raw.autonomy : DEFAULTS.autonomy;
  return {
    version: AGENT_PROTOCOL_VERSION,
    paused: raw.paused === true,
    autonomy,
    privacy: {
      screen: raw.privacy?.screen !== false,
      clipboard: raw.privacy?.clipboard !== false,
      uiAutomation: raw.privacy?.uiAutomation !== false,
      browser: raw.privacy?.browser !== false,
      hardware: raw.privacy?.hardware !== false
    },
    cancelEpoch: Math.max(0, Number(raw.cancelEpoch) || 0),
    updatedAt: String(raw.updatedAt || '')
  };
}

export function readRuntimeState() {
  try { return cleanState(JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))); }
  catch { return cleanState(DEFAULTS); }
}

export function writeRuntimeState(patch = {}) {
  const current = readRuntimeState();
  const next = cleanState({
    ...current,
    ...patch,
    privacy: { ...current.privacy, ...(patch.privacy || {}) },
    updatedAt: new Date().toISOString()
  });
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function evaluateLocalAction(action, payload = {}, state = readRuntimeState()) {
  const name = String(action || '');
  if (CONTROL_ACTIONS.has(name)) return { allowed: true, reason: 'control', state };
  if (state.paused) return { allowed: false, reason: 'AGENT_PAUSED', state };

  if (!state.privacy.clipboard && ['read_clipboard', 'copy_text'].includes(name)) return { allowed: false, reason: 'PRIVACY_CLIPBOARD_DISABLED', state };
  if (!state.privacy.screen && name === 'screen_analyze') return { allowed: false, reason: 'PRIVACY_SCREEN_DISABLED', state };
  if (!state.privacy.uiAutomation && (name.startsWith('window_') || name.startsWith('ui_'))) return { allowed: false, reason: 'PRIVACY_UI_AUTOMATION_DISABLED', state };
  if (!state.privacy.browser && name.startsWith('browser_')) return { allowed: false, reason: 'PRIVACY_BROWSER_DISABLED', state };
  if (!state.privacy.hardware && name === 'hardware_status') return { allowed: false, reason: 'PRIVACY_HARDWARE_DISABLED', state };

  if (state.autonomy === 'observer' && !OBSERVER_ACTIONS.has(name)) return { allowed: false, reason: 'AUTONOMY_OBSERVER_READ_ONLY', state };
  if (payload?._sextaAgentTask === true && state.autonomy !== 'autonomous') return { allowed: false, reason: 'AUTONOMOUS_MODE_REQUIRED', state };

  return { allowed: true, reason: 'allowed', state };
}

export function publicRuntimeState(state = readRuntimeState()) {
  return {
    version: state.version,
    paused: state.paused,
    autonomy: state.autonomy,
    privacy: { ...state.privacy },
    cancelEpoch: state.cancelEpoch,
    updatedAt: state.updatedAt
  };
}
