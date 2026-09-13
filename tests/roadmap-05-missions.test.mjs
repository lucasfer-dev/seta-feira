import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../lib/tool-core.mjs', import.meta.url), 'utf8');
const policy = fs.readFileSync(new URL('../lib/tool-policy.mjs', import.meta.url), 'utf8');
const live = fs.readFileSync(new URL('../api/live-token.js', import.meta.url), 'utf8');
test('Mission Engine exposes explicit lifecycle controls', () => {
  for (const name of ['pc_mission_status','pc_mission_resume','pc_mission_cancel']) assert.match(source, new RegExp(name));
  assert.match(source, /MISSION_VERSION = '1\.1\.0'/);
  assert.match(source, /status = 'cancelled'/);
  assert.match(source, /runPcAgentTask\(\{ goal:mission\.goal/);
  assert.match(policy, /pc_mission_resume/);
  assert.match(policy, /requiresExplicit: true/);
  assert.match(live, /'pc_mission_status'/);
  assert.match(live, /'pc_mission_resume'/);
  assert.match(live, /'pc_mission_cancel'/);
});
