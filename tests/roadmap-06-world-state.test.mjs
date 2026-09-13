import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const agent = fs.readFileSync(new URL('../agent/agent-v3.mjs', import.meta.url), 'utf8');
test('heartbeat carries a compact unified World State', () => {
  assert.match(agent, /buildWorldState/); assert.match(agent, /version:'2\.0\.0'/); assert.match(agent, /activeWindow:local\.activeWindow/);
  assert.match(agent, /browser:browserAgent/); assert.match(agent, /currentProject/); assert.match(agent, /lastAction/);
});
