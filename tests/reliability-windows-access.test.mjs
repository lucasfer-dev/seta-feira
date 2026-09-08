import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Voice Reliability v10.1 carrega antes do Voice Core e protege continuação pós-tool', () => {
  const loader = read('public/voice-loader.js');
  const reliability = read('public/voice-reliability-v10-1.js');
  assert.ok(loader.indexOf('voice-reliability-v10-1.js') < loader.indexOf('voice-core-v10.js'));
  assert.match(reliability, /toolResponse/);
  assert.match(reliability, /premature_turn_boundary_suppressed/);
  assert.match(reliability, /tool_continuation_timeout/);
  assert.match(reliability, /socket\.close\(4011/);
});

test('Desktop ganha buffer próprio para reduzir underrun sem alterar Android/Firefox', () => {
  const output = read('public/voice-output-jitter-guard.js');
  assert.match(output, /IS_DESKTOP/);
  assert.match(output, /IS_DESKTOP \? 480 : 300/);
  assert.match(output, /IS_DESKTOP \? 900 : 600/);
  assert.match(output, /version: '2\.2\.0-desktop-headroom'/);
  assert.match(output, /return 'desktop'/);
});

test('telemetria de voz é persistida sem gravar transcrições', () => {
  const metrics = read('api/live-metrics.js');
  assert.match(metrics, /sexta_live_metrics/);
  assert.match(metrics, /client_timestamp/);
  assert.match(metrics, /turn_id/);
  assert.doesNotMatch(metrics, /body\.(?:transcript|content|userText|assistantText)/);
});

test('configurações oferecem controle explícito do Windows sem shell genérico', () => {
  const ui = read('public/windows-access-control.js');
  const app = read('public/app.js');
  const api = read('api/agent-control.js');
  assert.match(app, /windows-access-control\.js/);
  for (const capability of ['screen', 'clipboard', 'uiAutomation', 'browser', 'hardware']) {
    assert.match(ui, new RegExp(capability));
    assert.match(api, new RegExp(capability));
  }
  assert.match(ui, /Ativar controle completo/);
  assert.match(ui, /set_privacy/);
  assert.match(ui, /set_autonomy/);
  assert.doesNotMatch(ui, /shell|cmd\.exe|powershell\.exe/i);
});

test('Browser Agent preserva a aba útil entre processos e evita about:blank', () => {
  const browser = read('agent/browser-agent.mjs');
  assert.match(browser, /selectionPath/);
  assert.match(browser, /readPersistedSelection/);
  assert.match(browser, /setSelectedTarget/);
  assert.match(browser, /usefulPage/);
  assert.match(browser, /url !== 'about:blank'/);
});

test('Desktop 2.1.4 empacota o Browser Agent corrigido', () => {
  const pkg = JSON.parse(read('apps/desktop-electron/package.json'));
  assert.equal(pkg.version, '2.1.4');
  const filters = pkg.build.extraResources.flatMap(item => item.filter || []);
  assert.ok(filters.includes('browser-agent.mjs'));
  assert.ok(filters.includes('runtime-state.mjs'));
});
