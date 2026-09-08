import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('pc_screen_analyze não pede nova permissão quando o provedor visual cai', () => {
  const pc = read('lib/pc-desktop-tools.mjs');
  assert.match(pc, /visionProviderUnavailable/);
  assert.match(pc, /uiTreeFallback/);
  assert.match(pc, /permissionGranted: true/);
  assert.match(pc, /Não peça nova confirmação de permissão/);
  assert.match(pc, /fallback: 'ui_tree'/);
});

test('visão troca de modelo em timeout em vez de repetir modo compatível inutilmente', () => {
  const vision = read('api/pc-vision-analyze.js');
  assert.match(vision, /MODEL_TIMEOUT_MS = 7_500/);
  assert.match(vision, /REQUEST_BUDGET_MS = 15_800/);
  assert.match(vision, /permissionIssue: false/);
  assert.match(vision, /Timeout\/rede não é incompatibilidade de payload/);
});

test('declaração informa ao modelo que autorização local já foi concedida', () => {
  const pc = read('lib/pc-desktop-tools.mjs');
  assert.match(pc, /Quando esta ferramenta executa, a autorização local já foi concedida no PC Agent/);
});
