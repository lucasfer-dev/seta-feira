import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { classifyModelRoute, modelRouterStatus } from '../lib/model-router.mjs';
import { SAFE_ROUTINE_TOOLS, saveRoutine } from '../lib/routines.mjs';
import { saveEventRule } from '../lib/event-engine.mjs';
import { desktopProtocolActions } from '../lib/pc-command-protocol.mjs';

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SECRET_KEY = '';
process.env.SUPABASE_PUBLISHABLE_KEY = '';

test('model router classifica código e análise sem exigir modelo dedicado', () => {
  assert.equal(classifyModelRoute('corrige esse bug no meu projeto React'), 'coding');
  assert.equal(classifyModelRoute('analisa a arquitetura e compare as alternativas'), 'reasoning');
  assert.ok(modelRouterStatus().routes.fast);
});

test('routines aceitam primitives seguras e bloqueiam envio', async () => {
  assert.ok(SAFE_ROUTINE_TOOLS.has('pc_open_project'));
  const routine = await saveRoutine({ name: 'Modo teste v4', steps: [{ tool: 'pc_open_url', args: { url: 'https://example.com' } }] });
  assert.equal(routine.steps.length, 1);
  await assert.rejects(() => saveRoutine({ name: 'Rotina perigosa v4', steps: [{ tool: 'google_send_email', args: {} }] }), /ROUTINE_TOOL_BLOCKED/);
});

test('event engine valida regras de hardware', async () => {
  const rule = await saveEventRule({ name: 'RAM alta v4', type: 'memory_above', condition: { percent: 90 }, title: 'RAM alta' });
  assert.equal(rule.condition.percent, 90);
  await assert.rejects(() => saveEventRule({ name: 'RAM inválida v4', type: 'memory_above', condition: { percent: 150 } }), /EVENT_RULE_PERCENT_INVALID/);
});

test('desktop protocol transporta hardware sem abrir shell genérico', () => {
  assert.ok(desktopProtocolActions().includes('hardware_status'));
  assert.ok(!desktopProtocolActions().includes('shell'));
  assert.ok(!desktopProtocolActions().includes('exec'));
  const agent = fs.readFileSync(new URL('../agent/agent-v3.mjs', import.meta.url), 'utf8');
  assert.match(agent, /hardware_status/);
  assert.doesNotMatch(agent, /action === ['"]shell['"]/);
});

test('secure vault não é declarado como ferramenta que lê segredo', () => {
  const tools = fs.readFileSync(new URL('../lib/v4-tools.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(tools, /resolveSecret|secure_vault_get|secret_value/i);
  assert.match(fs.readFileSync(new URL('../agent/secure-vault.mjs', import.meta.url), 'utf8'), /ProtectedData/);
});
