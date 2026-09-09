import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function semverAtLeast(actual, minimum) {
  const parse = value => String(value || '').split('.').map(part => Number.parseInt(part, 10));
  const a = parse(actual);
  const b = parse(minimum);
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

test('Desktop moderno empacota fallback local de visão', () => {
  const pkg = JSON.parse(read('apps/desktop-electron/package.json'));
  assert.ok(semverAtLeast(pkg.version, '2.1.6'), `Desktop ${pkg.version} não pode regredir abaixo de 2.1.6`);
  const resources = pkg.build.extraResources.flatMap(item => item.filter || []);
  assert.ok(resources.includes('vision-fallback.mjs'));
});

test('start-cloud carrega fallback antes do Agent', () => {
  const start = read('agent/start-cloud.mjs');
  const fallback = start.indexOf("import('./vision-fallback.mjs')");
  const agent = start.indexOf("import('./agent-v3.mjs')");
  assert.ok(fallback >= 0 && agent > fallback);
});

test('pedidos semânticos de tela usam UI Automation local antes da visão por pixels', () => {
  const code = read('agent/vision-fallback.mjs');
  assert.match(code, /questionNeedsPixelVision/);
  assert.match(code, /uiTree\(140\)/);
  assert.match(code, /windowList\(12\)/);
  assert.match(code, /local-ui-automation-first/);
  assert.match(code, /semanticFirst/);
  assert.match(code, /permissionIssue: false/);
});

test('visão por pixels tem deadline curto e cai para UI Automation', () => {
  const code = read('agent/vision-fallback.mjs');
  assert.match(code, /LOCAL_VISION_DEADLINE_MS = 4200/);
  assert.match(code, /AbortSignal\.timeout\(LOCAL_VISION_DEADLINE_MS\)/);
  assert.match(code, /\[502, 503, 504\]/);
  assert.match(code, /ui-tree-deadline/);
  assert.match(code, /1\.1\.0-semantic-first/);
});

test('fallback de visão não abre nova primitive de processo ou shell', () => {
  const code = read('agent/vision-fallback.mjs');
  assert.match(code, /\/api\/pc-vision-analyze/);
  assert.match(code, /não solicite nova confirmação de permissão/);
  assert.doesNotMatch(code, /child_process|spawn\(|exec\(|powershell/i);
});
