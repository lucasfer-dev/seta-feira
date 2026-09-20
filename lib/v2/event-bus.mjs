import { EventEmitter } from 'node:events';

class SextaEventBus extends EventEmitter {
  emitEvent(type, payload = {}) {
    const event = {
      id: crypto.randomUUID(),
      type,
      payload,
      at: new Date().toISOString()
    };
    this.emit(type, event);
    this.emit('*', event);
    return event;
  }
}

import crypto from 'node:crypto';

export const events = new SextaEventBus();
events.setMaxListeners(100);
