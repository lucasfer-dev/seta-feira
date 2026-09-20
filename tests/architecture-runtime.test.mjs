import test from 'node:test';
import assert from 'node:assert/strict';

import { resetCapabilities, registerCapability } from '../lib/v2/capability-registry.mjs';
import { detectReflex } from '../lib/v2/reflex-engine.mjs';
import { orchestrator } from '../lib/v2/orchestrator.mjs';
import { resetWorldState, getWorldState, updateAudioState } from '../lib/v2/world-state.mjs';
import { SextaError, ERROR_CODES } from '../lib/v2/errors.mjs';
import { openConversationSession, touchConversationSession, closeConversationSession } from '../lib/voice/conversation-session.mjs';
import { AudioService } from '../lib/voice/audio-service.mjs';

test('standard error model preserves recovery metadata', () => {
  const error = new SextaError(ERROR_CODES.ACTION_NOT_VERIFIED, 'Falhou', { recoverable: true, retryable: true, details: { action: 'open' } });
  assert.deepEqual(error.toJSON(), {
    code: 'ACTION_NOT_VERIFIED',
    message: 'Falhou',
    recoverable: true,
    retryable: true,
    details: { action: 'open' }
  });
});

test('reflex engine resolves deterministic local commands without LLM', () => {
  assert.deepEqual(detectReflex('abre Chrome'), {
    mode: 'reflex',
    intent: 'computer.openApp',
    input: { app: 'Chrome' },
    confidence: 1
  });
  assert.equal(detectReflex('me ajuda a pensar sobre arquitetura'), null);
});

test('orchestrator executes registered reflex capability and updates world state', async () => {
  resetWorldState();
  resetCapabilities();
  let called = 0;
  registerCapability({
    name: 'computer.openApp',
    description: 'Open app',
    execute: async input => { called++; return { ok: true, app: input.app }; },
    verify: async output => output.ok === true
  });

  const output = await orchestrator.handleInput({ text: 'abre VS Code' });
  assert.equal(output.mode, 'reflex');
  assert.equal(output.result.app, 'VS Code');
  assert.equal(called, 1);
  assert.equal(getWorldState().computer.lastAction, 'computer.openApp');
});

test('conversation session keeps referential object during follow-up turns', () => {
  resetWorldState();
  const started = openConversationSession({ source: 'wake', idleMs: 60_000 });
  assert.equal(started.status, 'active');
  touchConversationSession({ lastObject: 'Envista' });
  const state = getWorldState();
  assert.equal(state.conversation.lastObject, 'Envista');
  assert.equal(state.conversation.sessionStatus, 'active');
  const closed = closeConversationSession('test');
  assert.equal(closed.reason, 'test');
  assert.equal(getWorldState().conversation.sessionStatus, 'closed');
});

test('world state exposes actionable audio diagnostics', () => {
  resetWorldState();
  updateAudioState({
    inputDevice: 'Microfone USB',
    inputLevel: 0.37,
    speechDetected: true,
    wakeEngine: 'online',
    wakeModel: 'sexta-feira-v1',
    realtime: 'connected'
  });
  assert.deepEqual(getWorldState().audio, {
    inputDevice: 'Microfone USB',
    outputDevice: null,
    inputLevel: 0.37,
    speechDetected: true,
    wakeEngine: 'online',
    wakeModel: 'sexta-feira-v1',
    lastWakeAt: null,
    realtime: 'connected'
  });
});

test('audio service exposes level, speech and device diagnostics through world state', async () => {
  resetWorldState();
  let callbacks;
  const service = new AudioService({
    async start(input) {
      callbacks = input;
      return { inputDevice: 'Test Mic', outputDevice: 'Test Speakers' };
    },
    async stop() {}
  });
  await service.start();
  callbacks.onLevel(0.42);
  callbacks.onSpeech(true);
  const state = getWorldState();
  assert.equal(state.audio.inputDevice, 'Test Mic');
  assert.equal(state.audio.outputDevice, 'Test Speakers');
  assert.equal(state.audio.inputLevel, 0.42);
  assert.equal(state.audio.speechDetected, true);
  await service.stop();
});
