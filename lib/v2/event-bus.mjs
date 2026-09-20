import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

class SextaEventBus extends EventEmitter {
  emitEvent(type, payload = {}, meta = {}) {
    if (!type || typeof type !== 'string') throw new Error('EVENT_TYPE_REQUIRED');
    const event = {
      id: crypto.randomUUID(),
      type,
      payload,
      at: new Date().toISOString(),
      traceId: meta.traceId || payload?.traceId || null,
      missionId: meta.missionId || payload?.missionId || null,
      deviceId: meta.deviceId || payload?.deviceId || null,
      actionId: meta.actionId || payload?.actionId || null
    };
    this.emit(type, event);
    this.emit('*', event);
    return event;
  }

  waitFor(type, { timeoutMs = 5000, predicate = () => true } = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`EVENT_TIMEOUT:${type}`));
      }, timeoutMs);
      timeout.unref?.();

      const onEvent = event => {
        if (!predicate(event)) return;
        cleanup();
        resolve(event);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off(type, onEvent);
      };

      this.on(type, onEvent);
    });
  }
}

export const events = new SextaEventBus();
events.setMaxListeners(100);
