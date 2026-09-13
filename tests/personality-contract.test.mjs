import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  buildPersonalityContract,
  buildSpeechDirection,
  normalizePersonality,
  SEXTA_PERSONALITY_DEFAULTS,
  SEXTA_PERSONALITY_VERSION
} from '../public/sexta-personality.js';

test('canonical personality has the operational defaults', () => {
  assert.equal(SEXTA_PERSONALITY_VERSION, '2.1.0');
  assert.deepEqual(
    {
      humor:SEXTA_PERSONALITY_DEFAULTS.humor,
      sarcasm:SEXTA_PERSONALITY_DEFAULTS.sarcasm,
      proactivity:SEXTA_PERSONALITY_DEFAULTS.proactivity,
      verbosity:SEXTA_PERSONALITY_DEFAULTS.verbosity
    },
    { humor:45, sarcasm:25, proactivity:78, verbosity:22 }
  );
});

test('legacy untouched defaults migrate while custom choices are preserved', () => {
  const migrated = normalizePersonality({ humor:68, sarcasm:42, proactivity:55, verbosity:32 });
  assert.equal(migrated.humor, 45);
  assert.equal(migrated.proactivity, 78);
  const custom = normalizePersonality({ humor:70, sarcasm:42, proactivity:55, verbosity:32 });
  assert.equal(custom.humor, 70);
  assert.equal(custom.sarcasm, 42);
});

test('contract defines modes, truthful actions, bounded initiative, chefe treatment and original voice', () => {
  const contract = buildPersonalityContract({}, { channel:'voice-live', platform:'android' });
  for (const marker of ['CASUAL', 'OPERACAO', 'AGUARDANDO', 'CONCLUIDO', 'FALHA', 'URGENTE']) {
    assert.match(contract, new RegExp(marker));
  }
  assert.match(contract, /confirmação real da ferramenta/);
  assert.match(contract, /sinal concreto/);
  assert.match(contract, /exclusivamente como “chefe”/);
  assert.match(contract, /Não use senhor, parceiro, mano, Lucas/);
  assert.match(contract, /feminina brasileira original/);
  assert.match(contract, /Nunca imite voz/);
  assert.match(buildSpeechDirection({}), /Nunca soar como locutora/);
});

test('all active response paths consume the canonical contract', () => {
  const files = [
    '../public/voice-core-v10.js',
    '../api/live-token.js',
    '../api/tts.js',
    '../lib/core.mjs',
    '../api/sync.js'
  ].map(path => fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
  for (const source of files) assert.match(source, /sexta-personality\.js/);

  const android = fs.readFileSync(new URL('../apps/android-capacitor/native/java/SextaForegroundService.java', import.meta.url), 'utf8');
  assert.match(android, /personalityInstruction/);
});

test('live voice requires wake word and desktop barge-in is wake-gated', () => {
  const live = fs.readFileSync(new URL('../api/live-token.js', import.meta.url), 'utf8');
  assert.match(live, /WAKE WORD OBRIGATÓRIA/);
  assert.match(live, /só ceda a vez quando a entrada tiver sido liberada pelo detector local da wake word/);
  assert.doesNotMatch(live, /não precisa repetir “Sexta-feira” antes de cada fala/);

  const guard = fs.readFileSync(new URL('../public/voice-barge-in-guard.js', import.meta.url), 'utf8');
  assert.match(guard, /1\.3\.0-strict-desktop-wake/);
  assert.match(guard, /sexta:wake-word/);
  assert.match(guard, /strictWakeLatched/);
  assert.match(guard, /WAKE_COMMAND_WINDOW_MS = 5200/);
});

test('voice endpointing adapts to commands, conversation and dictation', () => {
  const voice = fs.readFileSync(new URL('../public/voice-core-v10.js', import.meta.url), 'utf8');
  assert.match(voice, /SHORT_SPEECH_RELEASE_MS = 520/);
  assert.match(voice, /NORMAL_SPEECH_RELEASE_MS = 650/);
  assert.match(voice, /DICTATION_SPEECH_RELEASE_MS = 850/);
  assert.match(voice, /speechReleaseMs\(now\)/);
});
