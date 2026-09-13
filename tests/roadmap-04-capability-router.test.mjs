import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCapabilityRoute } from '../lib/capability-router.mjs';
test('capability router only exposes explicit allowlisted routes', () => {
  assert.equal(resolveCapabilityRoute('windows','open_app')?.tool, 'pc_open_app');
  assert.equal(resolveCapabilityRoute('browser','snapshot')?.tool, 'pc_browser_snapshot');
  assert.equal(resolveCapabilityRoute('codex','task')?.tool, 'pc_codex_task');
  assert.equal(resolveCapabilityRoute('windows','shell'), null);
  assert.equal(resolveCapabilityRoute('unknown','anything'), null);
});
