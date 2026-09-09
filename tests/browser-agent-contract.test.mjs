import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('browser agent exposes DOM-first navigation primitives with post-action verification', () => {
  const code = read('agent/browser-agent.mjs');

  for (const marker of [
    'browserOpen',
    'browserTabs',
    'browserSelectTab',
    'browserSnapshot',
    'browserClick',
    'browserType',
    'browserBack',
    'browserForward',
    'browserReload'
  ]) {
    assert.match(code, new RegExp(`(?:function\\s+${marker}\\b|${marker}\\s*\\()`));
  }

  assert.match(code, /Page\.navigate/);
  assert.match(code, /Page\.getNavigationHistory/);
  assert.match(code, /Page\.navigateToHistoryEntry/);
  assert.match(code, /Page\.reload/);
  assert.match(code, /Runtime\.evaluate/);
  assert.match(code, /data-sexta-ref/);
  assert.match(code, /snapshots\s*=\s*new Map\(\)/);
  assert.match(code, /PC_BROWSER_STALE_SNAPSHOT/);
  assert.match(code, /PC_BROWSER_PASSWORD_FIELD_BLOCKED/);
  assert.match(code, /safeValue=password\?'':String\(el\.value\|\|''\)/);
  assert.match(code, /verified/);
});
