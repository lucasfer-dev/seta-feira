import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { DEFAULT_WAKE_PHRASES, parseWakeTranscript } from '../agent/wake-word.mjs';

test('wake transcript captures command after Sexta-Feira', () => {
  assert.deepEqual(parseWakeTranscript('Sexta-feira, abre o Chrome'), {
    phrase: 'Sexta-feira',
    command: 'abre o Chrome'
  });
  assert.deepEqual(parseWakeTranscript('sexta feira qual é minha agenda?'), {
    phrase: 'sexta feira',
    command: 'qual é minha agenda?'
  });
  assert.equal(parseWakeTranscript('abre o Chrome'), null);
  assert.ok(DEFAULT_WAKE_PHRASES.includes('sexta-feira'));
  assert.equal(DEFAULT_WAKE_PHRASES.some(item => item.startsWith('seta')), false);
});

test('desktop wake does not show or focus the main window', () => {
  const source = fs.readFileSync(new URL('../apps/desktop-electron/main.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('function handleWake(');
  const end = source.indexOf('function scheduleWakeRestart', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.doesNotMatch(block, /win\.show\s*\(/);
  assert.doesNotMatch(block, /win\.focus\s*\(/);
  assert.match(block, /sexta:wake-word/);
});

test('desktop renderer stays active while hidden for wake voice handoff', () => {
  const source = fs.readFileSync(new URL('../apps/desktop-electron/main.cjs', import.meta.url), 'utf8');
  assert.match(source, /backgroundThrottling:\s*false/);
});

test('wake listener uses dedicated continuous grammar instead of free dictation only', () => {
  const source = fs.readFileSync(new URL('../agent/wake-word.mjs', import.meta.url), 'utf8');
  assert.match(source, /sexta-wake/);
  assert.match(source, /sexta-command/);
  assert.match(source, /RecognizeAsync/);
  assert.match(source, /RecognizeMode\]::Multiple/);
  assert.match(source, /DEFAULT_MIN_CONFIDENCE = 0\.32/);
});

test('desktop declares wake diagnostics before wake callbacks use it', () => {
  const source = fs.readFileSync(new URL('../apps/desktop-electron/main.cjs', import.meta.url), 'utf8');
  const declaration = source.indexOf('let wakeDiagnostics =');
  const firstUse = source.indexOf('wakeDiagnostics = { ...wakeDiagnostics');
  assert.ok(declaration >= 0, 'wakeDiagnostics declaration missing');
  assert.ok(firstUse > declaration, 'wakeDiagnostics must be declared before callback use');
});

test('wake diagnostics include language fallback mode', () => {
  const source = fs.readFileSync(new URL('../agent/wake-word.mjs', import.meta.url), 'utf8');
  assert.match(source, /preferredCulture/);
  assert.match(source, /hasPortuguese/);
  assert.match(source, /six the fair/);
  assert.match(source, /DEFAULT_MIN_CONFIDENCE = 0\.24/);
});
