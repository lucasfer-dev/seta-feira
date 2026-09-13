import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../agent/browser-agent.mjs', import.meta.url), 'utf8');
test('Browser Agent rejects stale snapshots/tabs and only retries transient CDP sockets once', () => {
  assert.match(source, /SNAPSHOT_TTL_MS = 12_000/); assert.match(source, /TAB_LIST_TTL_MS = 10_000/); assert.match(source, /TTL_EXPIRED/);
  assert.match(source, /CDP_SOCKET_FAILED\|CDP_TIMEOUT/); assert.match(source, /snapshotInvalidated:true/);
});
