import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../public/proactivity-engine.js', import.meta.url), 'utf8');
test('proactivity has quiet hours, dedupe, cooldown and restores voice', () => {
  assert.match(source, /QUIET_HOURS_URGENT_PRIORITY = 99/); assert.match(source, /URGENT_COOLDOWN_MS/); assert.match(source, /DEDUPE_TTL_MS/);
  assert.match(source, /quietHoursActive/); assert.match(source, /resumeVoiceAfterUrgent/);
});
