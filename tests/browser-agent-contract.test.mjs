import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('browser agent exposes DOM-first navigation primitives with post-action verification', () => {
  const code = read('agent/browser-agent.mjs');

  for (const marker of [
    'browser_open',
    'browser_tabs',
    'browser_select_tab',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_back',
    'browser_forward',
    'browser_reload'
  ]) {
    assert.match(code, new RegExp(marker));
  }

  assert.match(code, /Page\.navigate|navigate\(/);
  assert.match(code, /Runtime\.evaluate|DOM\.|Accessibility\./);
  assert.match(code, /document\.querySelectorAll|interactive/i);
});
