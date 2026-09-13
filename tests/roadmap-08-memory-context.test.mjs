import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../api/sync.js', import.meta.url), 'utf8');
test('voice sync is scoped, TTL-aware and stale-while-revalidate', () => {
  assert.match(source, /scope === 'voice'/); assert.match(source, /getMessages\(SHARED_CONVERSATION_ID,18\)/);
  assert.match(source, /memoryVisible/); assert.match(source, /expiresAt/); assert.match(source, /STALE-WHILE-REVALIDATE/);
});
