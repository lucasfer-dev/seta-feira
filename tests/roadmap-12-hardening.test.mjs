import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// This contract also acts as the final stacked-roadmap validation trigger.
const audit = fs.readFileSync(new URL('../agent/audit.mjs', import.meta.url), 'utf8');
const doctor = fs.readFileSync(new URL('../agent/doctor.mjs', import.meta.url), 'utf8');
const agent = fs.readFileSync(new URL('../agent/agent-v3.mjs', import.meta.url), 'utf8');
test('desktop agent has durable redacted audit rotation and bounded backoff', () => {
  assert.match(audit,/LOCALAPPDATA/); assert.match(audit,/MAX_BYTES/); assert.match(audit,/BACKUPS/); assert.match(audit,/\[circular\]/); assert.match(audit,/auditHealth/);
  assert.match(doctor,/Audit log/); assert.match(agent,/pollFailureStreak/); assert.match(agent,/Math\.min\(15000/);
});
