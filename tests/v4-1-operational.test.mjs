import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { saveMemory } from '../lib/core.mjs';
import { EVENT_ENGINE_VERSION } from '../lib/event-engine.mjs';
import { searchMemories } from '../lib/memory-search.mjs';
import { PC_COMMAND_PROTOCOL_VERSION, decodeDesktopCommand, encodeDesktopCommand } from '../lib/pc-command-protocol.mjs';
import { matchRoutine, ROUTINES_VERSION, saveRoutine } from '../lib/routines.mjs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Event Engine v2 mantém cron observacional e novos tipos', () => {
  assert.equal(EVENT_ENGINE_VERSION, '2.0.0');
  const source = read('lib/event-engine.mjs');
  for (const type of ['cpu_above', 'battery_below', 'device_stale', 'notification_keyword', 'schedule_weekdays']) assert.match(source, new RegExp(type));
  const cron = read('api/cron-event-engine.js');
  assert.match(cron, /runEventEngine/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /x-vercel-cron-schedule/);
  assert.doesNotMatch(cron, /queueCommand|executeTool|child_process|spawn\s*\(|exec\s*\(/);
});

test('Routines v2 encontram aliases naturais e preservam allowlist', async () => {
  assert.equal(ROUTINES_VERSION, '2.0.0');
  const routine = await saveRoutine({
    name: `Programação Teste ${process.pid}`,
    aliases: ['modo programação teste', 'abrir bancada teste'],
    steps: [{ tool: 'pc_system_info', args: {} }]
  });
  assert.ok(routine.id);
  const match = await matchRoutine('ativa o modo programação teste agora');
  assert.ok(match);
  assert.equal(match.routine.id, routine.id);
  await assert.rejects(() => saveRoutine({ name: `Bloqueada ${process.pid}`, steps: [{ tool: 'pc_ui_type_text', args: { text: 'x' } }] }), /ROUTINE_TOOL_BLOCKED/);
});

test('Busca de memória prioriza relevância sem apagar nada', async () => {
  const unique = `alfa-nebulosa-${process.pid}-${Date.now()}`;
  await saveMemory({ content: `Projeto ${unique} usa arquitetura de eventos distribuídos.`, kind: 'project', importance: 0.8, source: 'test' });
  await saveMemory({ content: 'Preferência genérica sem relação com o termo pesquisado.', kind: 'preference', importance: 0.2, source: 'test' });
  const results = await searchMemories(unique, { limit: 5 });
  assert.ok(results.length >= 1);
  assert.match(results[0].content, new RegExp(unique));
  assert.ok(results[0].relevance > 0);
});

test('Desktop protocol v3 aceita controle de janelas, UI e navegação multi-aba sem shell', () => {
  assert.equal(PC_COMMAND_PROTOCOL_VERSION, 3);
  const cases = [
    ['browser_tabs', {}],
    ['browser_select_tab', { index: 1 }],
    ['browser_forward', {}],
    ['browser_reload', {}],
    ['window_close', { title: 'Bloco de Notas' }],
    ['window_state', { title: 'Bloco de Notas', state: 'minimize' }],
    ['window_move_resize', { title: 'Bloco de Notas', x: 100, y: 100, width: 640, height: 480 }],
    ['ui_action', { action: 'focus', name: 'Pesquisar' }]
  ];
  for (const [action, payload] of cases) {
    const encoded = encodeDesktopCommand(action, payload);
    const decoded = decodeDesktopCommand(encoded.action, encoded.payload);
    assert.equal(decoded.action, action);
  }
  assert.throws(() => encodeDesktopCommand('shell', { command: 'whoami' }), /ACTION_BLOCKED/);
});

test('Browser Agent v2 mantém bloqueios sensíveis e não adiciona downloads/uploads', () => {
  const source = read('agent/browser-agent.mjs');
  for (const name of ['browserTabs', 'browserSelectTab', 'browserForward', 'browserReload']) assert.match(source, new RegExp(`export async function ${name}`));
  assert.match(source, /PC_BROWSER_SENSITIVE_CONTROL_BLOCKED/);
  assert.match(source, /PC_BROWSER_PASSWORD_FIELD_BLOCKED/);
  assert.doesNotMatch(source, /Page\.setDownloadBehavior|DOM\.setFileInputFiles|uploadFile/);
});

test('Desktop recovery e updater exigem confirmação do usuário', () => {
  const source = read('apps/desktop-electron/main.cjs');
  assert.match(source, /fallback\.html/);
  assert.match(source, /autoDownload = false/);
  assert.match(source, /Baixar atualização/);
  assert.match(source, /Reiniciar e instalar/);
  assert.match(source, /scheduleAgentRestart/);
  assert.match(source, /scheduleWakeRestart/);
});
