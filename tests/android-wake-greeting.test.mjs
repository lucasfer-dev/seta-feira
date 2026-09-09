import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const prepare = fs.readFileSync(new URL('../apps/android-capacitor/scripts/prepare-wake-greeting.mjs', import.meta.url), 'utf8');
const greeting = fs.readFileSync(new URL('../apps/android-capacitor/native/java/StartupGreeting.java', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../apps/android-capacitor/package.json', import.meta.url), 'utf8'));

test('Android build applies wake gate after all other native preparation steps', () => {
  assert.match(pkg.scripts['android:prepare'], /stabilize-android-runtime\.mjs && node scripts\/prepare-wake-greeting\.mjs$/);
  assert.match(prepare, /SEXTA_WAKE_GATED_INPUT/);
  assert.match(prepare, /assistantSpeaking\.get\(\)\) continue/);
  assert.match(prepare, /SEXTA_WAKE_GATED_TURN_COMPLETE/);
  assert.match(prepare, /finishNativeConversation\(false\)/);
  assert.match(prepare, /aguardando “Sexta-feira”/);
});

test('startup greeting uses local Android time and chefe address', () => {
  assert.match(greeting, /Calendar\.getInstance\(\)\.get\(Calendar\.HOUR_OF_DAY\)/);
  assert.match(greeting, /Bom dia, chefe\./);
  assert.match(greeting, /Boa tarde, chefe\./);
  assert.match(greeting, /Boa noite, chefe\./);
  assert.match(greeting, /MIN_GREETING_INTERVAL_MS = 20_000L/);
  assert.match(prepare, /StartupGreeting\.onAppOpened\(this\)/);
});

test('Android wake-gated release marker is 4.1.2', () => {
  assert.equal(pkg.version, '4.1.2');
});
