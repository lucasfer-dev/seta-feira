import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateToolPolicy, getToolPolicy } from '../lib/tool-policy.mjs';
import { PC_DESKTOP_TOOL_DECLARATIONS } from '../lib/pc-desktop-tools.mjs';

const browser = fs.readFileSync(new URL('../agent/browser-agent.mjs', import.meta.url), 'utf8');
const windowsUi = fs.readFileSync(new URL('../agent/windows-ui.mjs', import.meta.url), 'utf8');
const toolCore = fs.readFileSync(new URL('../lib/tool-core.mjs', import.meta.url), 'utf8');
const agent = fs.readFileSync(new URL('../agent/agent.mjs', import.meta.url), 'utf8');

test('desktop private reads require current-turn intent', () => {
  for (const tool of ['pc_screen_analyze', 'pc_ui_tree', 'pc_window_list', 'pc_browser_snapshot']) {
    const blocked = evaluateToolPolicy(tool, {}, { enforceExplicit: true, userText: 'bom dia sexta' });
    assert.equal(blocked.allowed, false, tool);
    const allowed = evaluateToolPolicy(tool, {}, { enforceExplicit: true, userText: 'olha a tela do meu PC e vê o que está aberto' });
    assert.equal(allowed.allowed, true, tool);
  }
});

test('clipboard access is scoped to explicit clipboard intent', () => {
  assert.equal(evaluateToolPolicy('pc_clipboard_read', {}, { enforceExplicit: true, userText: 'bom dia' }).allowed, false);
  assert.equal(evaluateToolPolicy('pc_clipboard_read', {}, { enforceExplicit: true, userText: 'o que está copiado no clipboard do PC?' }).allowed, true);
  assert.equal(evaluateToolPolicy('pc_clipboard_write', {}, { enforceExplicit: true, userText: 'coloca esse texto no clipboard do PC' }).allowed, true);
});

test('autonomous desktop task requires an explicit PC goal', () => {
  const blocked = evaluateToolPolicy('pc_agent_task', {}, { enforceExplicit: true, userText: 'me conta uma piada' });
  assert.equal(blocked.allowed, false);
  const allowed = evaluateToolPolicy('pc_agent_task', {}, { enforceExplicit: true, userText: 'no computador, abre o navegador e acha a documentação' });
  assert.equal(allowed.allowed, true);
  assert.equal(getToolPolicy('pc_agent_task').sideEffect, 'autonomous-local-action');
});

test('browser and Windows generic hands block sensitive final controls and passwords', () => {
  assert.match(browser, /PC_BROWSER_SENSITIVE_CONTROL_BLOCKED/);
  assert.match(browser, /PC_BROWSER_PASSWORD_FIELD_BLOCKED/);
  assert.match(windowsUi, /PC_UI_SENSITIVE_CONTROL_BLOCKED/);
  assert.match(windowsUi, /PC_UI_PASSWORD_FIELD_BLOCKED/);
  assert.doesNotMatch(windowsUi, /Start-Process\s+.+-Verb\s+RunAs/i);
});

test('desktop agent exposes structured primitives without arbitrary shell tool', () => {
  const names = PC_DESKTOP_TOOL_DECLARATIONS.map(tool => tool.name);
  for (const required of ['pc_screen_analyze','pc_ui_tree','pc_ui_click_text','pc_browser_snapshot','pc_browser_click','pc_agent_task','pc_clipboard_read','pc_clipboard_write']) {
    assert.ok(names.includes(required), required);
  }
  assert.match(toolCore, /OBSERVE.*AJA.*VERIFIQUE/i);
  assert.match(agent, /screen_analyze/);
  assert.doesNotMatch(agent, /action === ['"]shell['"]/);
  assert.doesNotMatch(agent, /action === ['"]exec['"]/);
});
