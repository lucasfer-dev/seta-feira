import crypto from 'node:crypto';
import { events } from '../v2/event-bus.mjs';
import { patchWorldState } from '../v2/world-state.mjs';

const DEFAULT_IDLE_MS = 45_000;
let session = null;
let idleTimer = null;

function clearTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleClose(idleMs) {
  clearTimer();
  idleTimer = setTimeout(() => closeConversationSession('idle_timeout'), idleMs);
  idleTimer.unref?.();
}

export function getConversationSession() {
  return session ? structuredClone(session) : null;
}

export function openConversationSession({ source = 'wake', deviceId = null, idleMs = DEFAULT_IDLE_MS } = {}) {
  const now = new Date().toISOString();
  session = {
    id: crypto.randomUUID(),
    status: 'active',
    source,
    deviceId,
    startedAt: now,
    lastActivityAt: now,
    lastObject: null,
    turns: 0,
    idleMs
  };
  patchWorldState({ conversation: { sessionId: session.id, sessionStatus: 'active' } }, 'voice.session.started');
  events.emitEvent('voice.session.started', session);
  scheduleClose(idleMs);
  return getConversationSession();
}

export function touchConversationSession({ lastObject = undefined } = {}) {
  if (!session || session.status !== 'active') return null;
  session.lastActivityAt = new Date().toISOString();
  session.turns += 1;
  if (lastObject !== undefined) session.lastObject = lastObject;
  patchWorldState({
    conversation: {
      sessionId: session.id,
      sessionStatus: 'active',
      lastObject: session.lastObject
    }
  }, 'voice.session.activity');
  scheduleClose(session.idleMs || DEFAULT_IDLE_MS);
  return getConversationSession();
}

export function closeConversationSession(reason = 'closed') {
  if (!session) return null;
  clearTimer();
  const closed = { ...session, status: 'closed', reason, closedAt: new Date().toISOString() };
  session = null;
  patchWorldState({ conversation: { sessionId: null, sessionStatus: 'closed' } }, 'voice.session.closed');
  events.emitEvent('voice.session.closed', closed);
  return structuredClone(closed);
}
