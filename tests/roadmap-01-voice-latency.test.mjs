import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../public/voice-core-v10.js', import.meta.url), 'utf8');
test('voice core prewarms desktop resources and uses fast adaptive endpointing', () => {
  assert.match(source, /SHORT_SPEECH_RELEASE_MS = 260/);
  assert.match(source, /NORMAL_SPEECH_RELEASE_MS = 360/);
  assert.match(source, /DICTATION_SPEECH_RELEASE_MS = 560/);
  assert.match(source, /prewarmVoiceRuntime/);
  assert.match(source, /prepareMicrophone\(\{ activate:false \}\)/);
  assert.match(source, /scope=voice/);
  assert.match(source, /activityEndToSpeakingMs/);
  assert.match(source, /startup_setup_complete/);
});
