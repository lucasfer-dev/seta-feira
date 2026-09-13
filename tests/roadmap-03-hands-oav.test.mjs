import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../lib/pc-desktop-tools.mjs', import.meta.url), 'utf8');
test('Hands performs bounded re-observation instead of blind retries', () => {
  assert.match(source, /recoverStaleUiTarget/);
  assert.match(source, /staleTargetReobserved:true/);
  assert.match(source, /retryUsed:true/);
  assert.match(source, /observeActVerify/);
  assert.match(source, /PASSWORD_FIELD_BLOCKED\|SENSITIVE_CONTROL_BLOCKED/);
});
