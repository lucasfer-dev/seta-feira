import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../public/voice-output-jitter-guard.js', import.meta.url), 'utf8');

class FakeSource {
  constructor() {
    this.buffer = null;
    this.starts = [];
    this.stops = [];
    this.onended = null;
  }
  start(...args) { this.starts.push(args); }
  stop(...args) { this.stops.push(args); }
  connect() { return this; }
}

class FakeAudioContext {
  static instances = [];
  constructor(options = {}) {
    this.options = options;
    this._time = 1;
    this.state = 'running';
    this.destination = {};
    this.sources = [];
    FakeAudioContext.instances.push(this);
  }
  get currentTime() { return this._time; }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  resume() { return Promise.resolve(); }
}

function loadGuard(userAgent = 'Mozilla/5.0 Firefox/154.0') {
  FakeAudioContext.instances.length = 0;
  const window = {
    __sextaNativeAudioContext: FakeAudioContext,
    AudioContext: FakeAudioContext,
    webkitAudioContext: null
  };
  const context = {
    window,
    navigator: { userAgent },
    localStorage: { getItem: () => '' },
    fetch: async () => ({ ok: true }),
    console
  };
  vm.runInNewContext(code, context);
  return window;
}

test('browser output context uses a delayed virtual clock while input stays untouched', () => {
  const window = loadGuard();
  const GuardedAudioContext = window.__sextaNativeAudioContext;

  const output = new GuardedAudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
  assert.equal(Math.round(output.currentTime * 1000), 915);

  const nativeOutput = FakeAudioContext.instances[0];
  const source = output.createBufferSource();
  source.buffer = { duration: 0.1 };
  source.start(1.1);
  assert.equal(Math.round(nativeOutput.sources[0].starts[0][0] * 1000), 1185);

  const input = new GuardedAudioContext({ latencyHint: 'interactive' });
  assert.equal(input.currentTime, 1);
  assert.equal(window.__sextaOutputJitterGuard.debug().extraBufferMs, 85);
});

test('android keeps the extra output buffer smaller because v10 already prebuffers more', () => {
  const window = loadGuard('Mozilla/5.0 (Linux; Android 15)');
  const GuardedAudioContext = window.__sextaNativeAudioContext;
  const output = new GuardedAudioContext({ sampleRate: 24000 });
  assert.equal(Math.round(output.currentTime * 1000), 965);
  assert.equal(window.__sextaOutputJitterGuard.debug().extraBufferMs, 35);
});
