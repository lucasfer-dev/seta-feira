import test from 'node:test';
import assert from 'node:assert/strict';

import { getSyncCache, invalidateSyncCache, loadSyncCache, syncCacheGeneration } from '../lib/sync-cache.mjs';

test('invalidação remove snapshot imediatamente', async () => {
  invalidateSyncCache();
  await loadSyncCache(async () => ({ messages: [1] }));
  assert.deepEqual(getSyncCache(), { messages: [1] });
  invalidateSyncCache();
  assert.equal(getSyncCache(), null);
});

test('snapshot iniciado antes de uma escrita não volta ao cache', async () => {
  invalidateSyncCache();
  const generation = syncCacheGeneration();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const loading = loadSyncCache(async () => {
    await wait;
    return { stale: true };
  });
  invalidateSyncCache();
  release();
  assert.deepEqual(await loading, { stale: true });
  assert.equal(getSyncCache(), null);
  assert.ok(syncCacheGeneration() > generation);
});
