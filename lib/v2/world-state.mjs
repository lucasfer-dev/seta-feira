import { events } from './event-bus.mjs';

const initialState = () => ({
  version: 2,
  updatedAt: new Date().toISOString(),
  activeDeviceId: null,
  user: { id: null, locale: 'pt-BR' },
  conversation: {
    sessionId: null,
    sessionStatus: 'closed',
    currentTopic: null,
    lastObject: null,
    lastIntent: null,
    lastUserText: null,
    lastAssistantText: null
  },
  computer: {
    online: false,
    foregroundApp: null,
    activeWindow: null,
    project: null,
    cwd: null,
    lastAction: null
  },
  browser: {
    activeTab: null,
    url: null,
    title: null
  },
  audio: {
    inputDevice: null,
    outputDevice: null,
    inputLevel: 0,
    speechDetected: false,
    wakeEngine: 'offline',
    wakeModel: null,
    lastWakeAt: null,
    realtime: 'disconnected'
  },
  devices: {},
  missions: {},
  presence: {
    mode: 'ambient',
    userSpeaking: false,
    assistantSpeaking: false,
    thinking: false,
    executing: false
  }
});

let state = initialState();

function touch() { state.updatedAt = new Date().toISOString(); }

export function getWorldState() { return structuredClone(state); }

export function patchWorldState(patch = {}, source = 'unknown') {
  state = {
    ...state,
    ...patch,
    user: { ...state.user, ...(patch.user || {}) },
    conversation: { ...state.conversation, ...(patch.conversation || {}) },
    computer: { ...state.computer, ...(patch.computer || {}) },
    browser: { ...state.browser, ...(patch.browser || {}) },
    audio: { ...state.audio, ...(patch.audio || {}) },
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
  if (patch.kind === 'desktop' || patch.kind === 'windows' || patch.kind === 'agent') {
    state.computer.online = patch.online ?? state.computer.online;
  }
  touch();
  events.emitEvent(patch.online === false ? 'device.offline' : 'device.online', { deviceId, device: structuredClone(state.devices[deviceId]) });
  events.emitEvent('device.changed', { deviceId, device: structuredClone(state.devices[deviceId]) });
  return structuredClone(state.devices[deviceId]);
}

export function updateAudioState(patch = {}) {
  state.audio = { ...state.audio, ...patch };
  touch();
  events.emitEvent('voice.audio.changed', { audio: structuredClone(state.audio) });
  return structuredClone(state.audio);
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
