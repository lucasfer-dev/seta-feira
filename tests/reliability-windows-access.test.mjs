import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const localPath = path => fileURLToPath(new URL(`../${path}`, import.meta.url));

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

test('guards novos passam no parser do Node', () => {
  for (const file of ['public/voice-reliability-v10-1.js', 'public/windows-access-control.js', 'public/voice-output-jitter-guard.js', 'api/live-metrics.js', 'agent/browser-agent.mjs']) {
    execFileSync(process.execPath, ['--check', localPath(file)], { stdio: 'pipe' });
  }
});

test('Voice Reliability v10.1 carrega antes do Voice Core e protege continuação pós-tool', () => {
  const loader = read('public/voice-loader.js');
  const reliability = read('public/voice-reliability-v10-1.js');
  assert.ok(loader.indexOf('voice-reliability-v10-1.js') < loader.indexOf('voice-core-v10.js'));
  assert.match(reliability, /toolResponse/);
  assert.match(reliability, /premature_turn_boundary_suppressed/);
  assert.match(reliability, /tool_continuation_timeout/);
  assert.match(reliability, /__sextaMarkToolContinuation/);
  assert.match(reliability, /playback-state/);
  assert.match(reliability, /10\.1\.1-playback-continuation-guard/);
  assert.match(reliability, /socket\.close\(4011/);
});

test('Desktop usa buffer adaptativo gap-aware sem aumentar a partida base', () => {
  const output = read('public/voice-output-jitter-guard.js');
  assert.match(output, /IS_DESKTOP/);
  assert.match(output, /IS_DESKTOP \? 480 : 300/);
  assert.match(output, /IS_DESKTOP \? 1100 : 600/);
  assert.match(output, /RING_GAP_SAFETY_MS/);
  assert.match(output, /RING_UNDERRUN_WINDOW_MS/);
  assert.match(output, /version: '2\.2\.1-gap-aware-desktop'/);
  assert.match(output, /return 'desktop'/);
});

test('telemetria de voz é persistida sem gravar transcrições', () => {
  const metrics = read('api/live-metrics.js');
  assert.match(metrics, /sexta_live_metrics/);
  assert.match(metrics, /client_timestamp/);
  assert.match(metrics, /turn_id/);
  assert.doesNotMatch(metrics, /body\.(?:transcript|content|userText|assistantText)/);
});

test('configurações oferecem controle explícito do Windows sem primitive de terminal', () => {
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
  assert.match(ui, /não recebe shell genérico/i);
  assert.doesNotMatch(ui, /cmd\.exe|powershell\.exe|\/api\/shell|child_process|spawn\s*\(/i);
});

test('Browser Agent preserva a aba útil entre processos e evita about:blank', () => {
  const browser = read('agent/browser-agent.mjs');
  assert.match(browser, /selectionPath/);
  assert.match(browser, /readPersistedSelection/);
  assert.match(browser, /setSelectedTarget/);
  assert.match(browser, /usefulPage/);
  assert.match(browser, /url\s*!==?\s*['"]about:blank['"]/);
});

test('Desktop moderno empacota o Browser Agent corrigido', () => {
  const pkg = JSON.parse(read('apps/desktop-electron/package.json'));
  assert.ok(semverAtLeast(pkg.version, '2.1.4'), `Desktop ${pkg.version} não pode regredir abaixo de 2.1.4`);
  const filters = pkg.build.extraResources.flatMap(item => item.filter || []);
  assert.ok(filters.includes('browser-agent.mjs'));
  assert.ok(filters.includes('runtime-state.mjs'));
});
