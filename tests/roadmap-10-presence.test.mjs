import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const orb = fs.readFileSync(new URL('../public/presence-orb-lite.js', import.meta.url), 'utf8');
const presence = fs.readFileSync(new URL('../public/presence-engine.js', import.meta.url), 'utf8');
test('presence orb reacts across listening/thinking/speaking/acting/recovery', () => {
  assert.match(orb, /sexta-presence-stage/); for (const state of ['listening','thinking','speaking','acting','reconnecting','error']) assert.match(orb,new RegExp(state));
  assert.match(presence, /recovering: 'reconnecting'/);
  assert.doesNotMatch(orb, /var\(--sexta-stage-energy\) \* \.08/);
});
