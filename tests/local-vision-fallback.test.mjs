import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Desktop 2.1.5 empacota fallback local de visão', () => {
  const pkg = JSON.parse(read('apps/desktop-electron/package.json'));
  assert.equal(pkg.version, '2.1.5');
  const resources = pkg.build.extraResources.flatMap(item => item.filter || []);
  assert.ok(resources.includes('vision-fallback.mjs'));
});

test('start-cloud carrega fallback antes do Agent', () => {
  const start = read('agent/start-cloud.mjs');
  const fallback = start.indexOf("import('./vision-fallback.mjs')");
  const agent = start.indexOf("import('./agent-v3.mjs')");
  assert.ok(fallback >= 0 && agent > fallback);
});

test('fallback local só intercepta visão e usa UI Automation em 502/503/504 ou timeout', () => {
  const code = read('agent/vision-fallback.mjs');
  assert.match(code, /\/api\/pc-vision-analyze/);
  assert.match(code, /\[502, 503, 504\]/);
  assert.match(code, /uiTree\(140\)/);
  assert.match(code, /permissionIssue: false/);
  assert.match(code, /não solicite nova confirmação de permissão/);
  assert.doesNotMatch(code, /child_process|spawn\(|exec\(|powershell/i);
});
