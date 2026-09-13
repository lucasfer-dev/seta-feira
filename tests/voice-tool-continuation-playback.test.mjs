import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/voice-reliability-v10-1.js', import.meta.url), 'utf8');

class FakeTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }
}

class FakeWebSocket extends FakeTarget {
  constructor(url) {
    super();
    this.url = url;
    this.sent = [];
    this.closed = [];
  }
  send(data) { this.sent.push(data); }
  close(code, reason) { this.closed.push({ code, reason }); }
}

function loadReliability() {
  const window = new FakeTarget();
  window.WebSocket = FakeWebSocket;
  window.sextaDesktop = { desktop: true };

  let nextTimer = 1;
  const timers = new Map();
  const metrics = [];

  const sandbox = {
    window,
    navigator: { userAgent: 'Electron/44.0.0' },
    localStorage: { getItem: () => '' },
    fetch: async (_url, init = {}) => {
      try { metrics.push(JSON.parse(init.body || '{}')); } catch {}
      return { ok: true };
    },
    setTimeout(fn, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    console,
    Date,
    JSON,
    Object,
    Proxy,
    Reflect,
    Set,
    WeakSet,
    String,
    Number,
    Boolean,
    Array,
    RegExp
  };

  vm.runInNewContext(code, sandbox, { filename: 'voice-reliability-v10-1.js' });
  return { window, timers, metrics };
}

test('playback iniciado depois de tool response impede fechamento pelo watchdog', async () => {
  const { window, timers, metrics } = loadReliability();
  const socket = new window.WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=test');

  socket.send(JSON.stringify({
    toolResponse: {
      functionResponses: [{ id: 'call-1', name: 'pc_screen_analyze', response: { ok: true } }]
    }
  }));

  assert.equal(timers.size, 1, 'o watchdog deve ser armado após toolResponse');
  assert.equal([...timers.values()][0].delay, 6500, 'tool concluída deve usar janela reduzida de continuação');

  window.dispatchEvent({ type: 'sexta:voice-state', detail: { state: 'speaking' } });
  assert.equal(timers.size, 0, 'o playback real deve cancelar o watchdog');
  assert.deepEqual(socket.closed, []);

  await Promise.resolve();
  assert.ok(metrics.some(metric => metric.kind === 'voice_reliability_v10_1:tool_continuation_started' && metric.source === 'playback-state'));
});

test('tool com falha reduz silêncio para 3,5s e registra nome e erro antes de recuperar', async () => {
  const { window, timers, metrics } = loadReliability();
  const socket = new window.WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=test');

  socket.send(JSON.stringify({
    toolResponse: {
      functionResponses: [{
        id: 'call-2',
        name: 'pc_ui_type_text',
        response: { ok: false, state: 'failed', error: 'PC_UI_TARGET_NOT_FOUND' }
      }]
    }
  }));

  assert.equal(timers.size, 1);
  const timer = [...timers.values()][0];
  assert.equal(timer.delay, 3500);
  timer.fn();
  assert.deepEqual(socket.closed, [{ code: 4012, reason: 'failed-tool-continuation-timeout' }]);

  await Promise.resolve();
  assert.ok(metrics.some(metric => metric.kind === 'voice_reliability_v10_1:tool_response_sent'
    && metric.failedToolNames === 'pc_ui_type_text'
    && metric.toolErrors === 'PC_UI_TARGET_NOT_FOUND'
    && metric.continuationTimeoutMs === 3500));
  assert.ok(metrics.some(metric => metric.kind === 'voice_reliability_v10_1:tool_continuation_timeout'
    && metric.failedToolNames === 'pc_ui_type_text'));
});
