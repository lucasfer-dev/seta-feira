import { events } from './event-bus.mjs';

const initialState = () => ({
  version: 1,
  updatedAt: new Date().toISOString(),
  activeDeviceId: null,
  conversation: {
    currentTopic: null,
    lastIntent: null,
    lastUserText: null,
    lastAssistantText: null
  },
  computer: {
    online: false,
    foregroundApp: null,
    activeWindow: null,
    project: null,
    cwd: null
  },
  devices: {},
  missions: {},
  presence: {
    mode: 'ambient',
    userSpeaking: false,
    assistantSpeaking: false
  }
});

let state = initialState();

function touch() {
  state.updatedAt = new Date().toISOString();
}

export function getWorldState() {
  return structuredClone(state);
}

export function patchWorldState(patch = {}, source = 'unknown') {
  state = {
    ...state,
    ...patch,
    conversation: { ...state.conversation, ...(patch.conversation || {}) },
    computer: { ...state.computer, ...(patch.computer || {}) },
    devices: { ...state.devices, ...(patch.devices || {}) },
    missions: { ...state.missions, ...(patch.missions || {}) },
    presence: { ...state.presence, ...(patch.presence || {}) }
  };
  touch();
  events.emitEvent('world.changed', { source, patch, state: getWorldState() });
  return getWorldState();
}

export function updateDeviceState(deviceId, patch = {}) {
  if (!deviceId) throw new Error('DEVICE_ID_REQUIRED');
  const current = state.devices[deviceId] || {};
  state.devices[deviceId] = { ...current, ...patch, id: deviceId, updatedAt: new Date().toISOString() };
  if (patch.active) state.activeDeviceId = deviceId;
  if (patch.kind === 'desktop' || patch.kind === 'windows') {
    state.computer.online = patch.online ?? state.computer.online;
  }
  touch();
  events.emitEvent('device.changed', { deviceId, device: structuredClone(state.devices[deviceId]) });
  return structuredClone(state.devices[deviceId]);
}

export function removeDeviceState(deviceId) {
  delete state.devices[deviceId];
  if (state.activeDeviceId === deviceId) state.activeDeviceId = null;
  touch();
  events.emitEvent('device.removed', { deviceId });
}

export function setPresence(patch = {}) {
  state.presence = { ...state.presence, ...patch };
  touch();
  events.emitEvent('presence.changed', { presence: structuredClone(state.presence) });
  return structuredClone(state.presence);
}

export function resetWorldState() {
  state = initialState();
  events.emitEvent('world.reset');
  return getWorldState();
}
