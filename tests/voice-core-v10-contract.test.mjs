import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const core = fs.readFileSync(new URL('../public/voice-core-v10.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../public/voice-loader.js', import.meta.url), 'utf8');
const health = fs.readFileSync(new URL('../api/health.js', import.meta.url), 'utf8');

test('Voice Core v10 owns manual turn boundaries', () => {
  assert.match(core, /vadMode:'manual'/);
  assert.match(core, /activityStart:\{\}/);
  assert.match(core, /activityEnd:\{\}/);
  assert.doesNotMatch(core, /audioStreamEnd/);
});

test('Voice Core v10 is the only loader target', () => {
  assert.match(loader, /voice-core-v10\.js/);
  assert.doesNotMatch(loader, /voice-core-v[5-9]\.js/);
  assert.doesNotMatch(loader, /fallback/i);
});

test('health identifies the active voice architecture', () => {
  assert.match(health, /3\.1\.0-voice-core-v10-personality-v2/);
  assert.match(health, /manual-local/);
  assert.match(health, /2\.0\.0-canonical-operational/);
});
