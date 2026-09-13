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
  for (const marker of ['CASUAL', 'OPERACAO', 'AGUARDANDO', 'CONCLUIDO', 'FALHA', 'URGENTE']) assert.match(contract, new RegExp(marker));
  assert.match(contract, /confirmação real da ferramenta/);
  assert.match(contract, /sinal concreto/);
  assert.match(contract, /exclusivamente como “chefe”/);
  assert.match(contract, /Não use senhor, parceiro, mano, Lucas/);
  assert.match(contract, /feminina brasileira original/);
  assert.match(contract, /Nunca imite voz/);
  assert.match(buildSpeechDirection({}), /Nunca soar como locutora/);
});

test('all active response paths consume the canonical contract', () => {
  const files = ['../public/voice-core-v10.js','../api/live-token.js','../api/tts.js','../lib/core.mjs','../api/sync.js']
    .map(path => fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
  for (const source of files) assert.match(source, /sexta-personality\.js/);
  const android = fs.readFileSync(new URL('../apps/android-capacitor/native/java/SextaForegroundService.java', import.meta.url), 'utf8');
  assert.match(android, /personalityInstruction/);
});

test('live voice requires wake word and desktop barge-in is wake-gated from startup', () => {
  const live = fs.readFileSync(new URL('../api/live-token.js', import.meta.url), 'utf8');
  assert.match(live, /WAKE WORD OBRIGATÓRIA/);
  assert.match(live, /sanitizeClientInstruction/);
  assert.match(live, /detector local da wake word/);
  assert.doesNotMatch(live, /CONVERSA LIVE:[^\n]*não precisa repetir “Sexta-feira”/);

  const guard = fs.readFileSync(new URL('../public/voice-barge-in-guard.js', import.meta.url), 'utf8');
  assert.match(guard, /1\.(?:3\.1-strict-from-start|4\.0-wake-command-window)/);
  assert.match(guard, /sexta:wake-word/);
  assert.match(guard, /strictWakeLatched = IS_DESKTOP/);
  assert.match(guard, /WAKE_COMMAND_WINDOW_MS = (?:5200|7000)/);

  const wake = fs.readFileSync(new URL('../agent/wake-word.mjs', import.meta.url), 'utf8');
  for (const phrase of ['sexta', 'sexta-feira', 'sexta feira', 'seta', 'seta-feira', 'seta feira']) assert.ok(wake.includes(`'${phrase}'`), phrase);

  const desktop = fs.readFileSync(new URL('../apps/desktop-electron/main.cjs', import.meta.url), 'utf8');
  assert.match(desktop, /wakeWordEnabled\(\).*wakeWordEnabled !== false/);
});

test('mission engine persists checkpoints and world state rides the heartbeat', () => {
  const tools = fs.readFileSync(new URL('../lib/tool-core.mjs', import.meta.url), 'utf8');
  assert.match(tools, /MISSION_VERSION = '1\.[01]\.0'/);
  assert.match(tools, /sexta-mission/);
  assert.match(tools, /findResumableMission/);
  assert.match(tools, /missionId/);
  assert.match(tools, /OBSERVE → AJA → VERIFIQUE/);

  const hardware = fs.readFileSync(new URL('../agent/hardware.mjs', import.meta.url), 'utf8');
  assert.match(hardware, /worldState/);
  assert.match(hardware, /activeWindow/);
  assert.match(hardware, /listWindows\(14\)/);
});

test('tool continuation recovers faster after failures and preserves diagnostic detail', () => {
  const reliability = fs.readFileSync(new URL('../public/voice-reliability-v10-1.js', import.meta.url), 'utf8');
  assert.match(reliability, /10\.1\.2-failed-tool-fast-recovery/);
  assert.match(reliability, /TOOL_CONTINUATION_TIMEOUT_MS = 6500/);
  assert.match(reliability, /FAILED_TOOL_CONTINUATION_TIMEOUT_MS = 3500/);
  assert.match(reliability, /failedToolNames/);
  assert.match(reliability, /toolErrors/);

  const metrics = fs.readFileSync(new URL('../api/live-metrics.js', import.meta.url), 'utf8');
  assert.match(metrics, /failedToolNames/);
  assert.match(metrics, /toolErrors/);
  assert.match(metrics, /continuationTimeoutMs/);
});

test('proactivity only interrupts at urgent priority and speaks with canonical TTS endpoint', () => {
  const proactive = fs.readFileSync(new URL('../public/proactivity-engine.js', import.meta.url), 'utf8');
  assert.match(proactive, /INTERRUPT_PRIORITY = 95/);
  assert.match(proactive, /ATTENTION_PRIORITY = 80/);
  assert.match(proactive, /sexta:proactive-interrupt/);
  assert.match(proactive, /fetch\('\/api\/tts'/);
  assert.match(proactive, /Chefe,/);
  assert.match(proactive, /1\.(?:2\.0-urgent-voice|3\.0-guardrails)/);
});

test('voice endpointing adapts to commands, conversation and dictation', () => {
  const voice = fs.readFileSync(new URL('../public/voice-core-v10.js', import.meta.url), 'utf8');
  assert.match(voice, /SHORT_SPEECH_RELEASE_MS = 260/);
  assert.match(voice, /NORMAL_SPEECH_RELEASE_MS = 360/);
  assert.match(voice, /DICTATION_SPEECH_RELEASE_MS = 560/);
  assert.match(voice, /speechReleaseMs\(now\)/);
});
