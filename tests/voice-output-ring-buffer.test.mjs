import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createProcessor(options = {}) {
  const source = fs.readFileSync(new URL('../public/live-output-worklet.js', import.meta.url), 'utf8');
  let RegisteredProcessor = null;
  let registeredName = '';

  class FakeAudioWorkletProcessor {
    constructor() {
      const messages = [];
      this.port = {
        messages,
        onmessage: null,
        postMessage(message) { messages.push(message); }
      };
    }
  }

  const sandbox = {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    sampleRate: 24000,
    Float32Array,
    Math,
    Number,
    registerProcessor(name, Processor) {
      registeredName = name;
      RegisteredProcessor = Processor;
    }
  };

  vm.runInNewContext(source, sandbox, { filename: 'live-output-worklet.js' });
  assert.equal(registeredName, 'sexta-output-ring-buffer');
  assert.ok(RegisteredProcessor);

  const processor = new RegisteredProcessor({
    processorOptions: {
      targetMs: 80,
      maxTargetMs: 140,
      stepMs: 20,
      ...options
    }
  });

  return processor;
}

function render(processor, frames = 128) {
  const output = new Float32Array(frames);
  processor.process([], [[output]]);
  return output;
}

function push(processor, id, frames, value = 0.5) {
  const samples = new Float32Array(frames);
  samples.fill(value);
  processor.port.onmessage({ data: { type: 'push', id, samples } });
}

test('ring buffer segura a saída até atingir o prebuffer alvo', () => {
  const processor = createProcessor({ targetMs: 80 }); // 1920 frames @ 24 kHz
  push(processor, 'a', 960);
  const beforeTarget = render(processor);
  assert.ok(beforeTarget.every(sample => sample === 0));

  push(processor, 'b', 960);
  const afterTarget = render(processor);
  assert.ok(afterTarget.some(sample => Math.abs(sample) > 0.01));
  assert.ok(processor.port.messages.some(message => message.type === 'playing'));
});

test('ring buffer detecta starvation curta e aumenta o alvo adaptativamente', () => {
  const processor = createProcessor({ targetMs: 80, maxTargetMs: 140, stepMs: 20 });
  push(processor, 'first', 1920);

  for (let i = 0; i < 15; i += 1) render(processor, 128); // consome 1920 frames
  render(processor, 128); // detecta starvation
  render(processor, 128); // pequeno gap real

  push(processor, 'second', 3000);

  const underrun = processor.port.messages.find(message => message.type === 'underrun');
  assert.ok(underrun, 'esperava evento de underrun após starvation curta');
  assert.ok(underrun.gapMs >= 0 && underrun.gapMs < 700);
  assert.equal(underrun.underruns, 1);
  assert.equal(underrun.targetMs, 100);

  const resumed = render(processor);
  assert.ok(resumed.some(sample => Math.abs(sample) > 0.01));
});

test('silêncio longo entre turnos não é classificado como underrun', () => {
  const processor = createProcessor({ targetMs: 80, maxTargetMs: 140, stepMs: 20 });
  push(processor, 'first', 1920);
  for (let i = 0; i < 15; i += 1) render(processor, 128);
  render(processor, 128); // entra em starvation

  // >700 ms de silêncio a 24 kHz.
  for (let i = 0; i < 140; i += 1) render(processor, 128);
  push(processor, 'next-turn', 1920);

  assert.equal(processor.port.messages.filter(message => message.type === 'underrun').length, 0);
});

test('clear encerra chunks pendentes sem deixar áudio na fila', () => {
  const processor = createProcessor({ targetMs: 80 });
  push(processor, 'a', 960);
  push(processor, 'b', 960);
  processor.port.onmessage({ data: { type: 'clear' } });

  assert.equal(processor.queuedFrames, 0);
  assert.equal(processor.queue.length, 0);
  assert.ok(processor.port.messages.some(message => message.type === 'chunk_end' && message.cancelled));
  assert.ok(render(processor).every(sample => sample === 0));
});
