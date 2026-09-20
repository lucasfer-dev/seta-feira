import crypto from 'node:crypto';
import { events } from './event-bus.mjs';
import { normalizeError } from './errors.mjs';

const components = new Map();

function now() { return new Date().toISOString(); }

export function createTrace(seed = {}) {
  return {
    traceId: seed.traceId || crypto.randomUUID(),
    missionId: seed.missionId || null,
    deviceId: seed.deviceId || null,
    actionId: seed.actionId || null
  };
}

export function setComponentStatus(name, status, detail = {}) {
  const entry = {
    name: String(name),
    status: String(status || 'UNKNOWN').toUpperCase(),
    updatedAt: now(),
    ...detail
  };
  components.set(entry.name, entry);
  events.emitEvent('health.component.changed', entry);
  return structuredClone(entry);
}

export function getComponentStatus(name) {
  const value = components.get(String(name));
  return value ? structuredClone(value) : null;
}

export function getHealthSnapshot() {
  return Object.fromEntries([...components.entries()].map(([key, value]) => [key, structuredClone(value)]));
}

export function recordFailure(component, error, context = {}) {
  const normalized = normalizeError(error);
  return setComponentStatus(component, 'FAILED', {
    reason: normalized.code,
    error: normalized.toJSON(),
    context
  });
}

export async function observedAction(name, trace, action) {
  const startedAt = Date.now();
  events.emitEvent('action.started', { name, ...trace });
  try {
    const result = await action();
    events.emitEvent('action.completed', {
      name,
      ...trace,
      durationMs: Date.now() - startedAt,
      result
    });
    return result;
  } catch (error) {
    const normalized = normalizeError(error);
    events.emitEvent('action.failed', {
      name,
      ...trace,
      durationMs: Date.now() - startedAt,
      error: normalized.toJSON()
    });
    throw normalized;
  }
}
