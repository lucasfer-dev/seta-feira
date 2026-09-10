import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateToolPolicy, getToolPolicy } from '../lib/tool-policy.mjs';
import { PC_DESKTOP_TOOL_DECLARATIONS } from '../lib/pc-desktop-tools.mjs';

const browser = fs.readFileSync(new URL('../agent/browser-agent.mjs', import.meta.url), 'utf8');
const windowsUi = fs.readFileSync(new URL('../agent/windows-ui.mjs', import.meta.url), 'utf8');
const windowsHotkey = fs.readFileSync(new URL('../agent/windows-hotkey.mjs', import.meta.url), 'utf8');
const windowsUiActions = fs.readFileSync(new URL('../agent/windows-ui-actions.mjs', import.meta.url), 'utf8');
const windowControl = fs.readFileSync(new URL('../agent/windows-control-v2.mjs', import.meta.url), 'utf8');
const toolCore = fs.readFileSync(new URL('../lib/tool-core.mjs', import.meta.url), 'utf8');
const agent = fs.readFileSync(new URL('../agent/agent-v3.mjs', import.meta.url), 'utf8');

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

test('explicit ordinary window manipulation is allowed without extra confirmation', () => {
  const cases = [
    ['pc_window_focus', {}, 'traz o VS Code pra frente no PC'],
    ['pc_window_close', {}, 'fecha o Spotify no computador'],
    ['pc_window_state', { state: 'minimize' }, 'minimiza o Discord no PC'],
    ['pc_window_state', { state: 'maximize' }, 'maximiza o navegador no PC'],
    ['pc_window_move_resize', {}, 'move a janela do VS Code no computador']
  ];
  for (const [name, args, userText] of cases) {
    const policy = evaluateToolPolicy(name, args, { enforceExplicit: true, userText });
    assert.equal(policy.allowed, true, `${name}: ${policy.reason}`);
    assert.equal(policy.sideEffect, 'local-action');
  }
});

test('generic UI typing remains an explicit high-risk write', () => {
  const typePolicy = getToolPolicy('pc_ui_action', { action: 'type' });
  const setPolicy = getToolPolicy('pc_ui_action', { action: 'set_value' });
  assert.equal(typePolicy.risk, 'high');
  assert.equal(typePolicy.sideEffect, 'write');
  assert.equal(setPolicy.risk, 'high');
  assert.equal(evaluateToolPolicy('pc_ui_action', { action: 'type' }, { enforceExplicit: true, userText: 'digita Lucas nesse campo no PC' }).allowed, true);
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
  assert.match(windowsUiActions, /PC_UI_SENSITIVE_CONTROL_BLOCKED/);
  assert.match(windowsUiActions, /PC_UI_PASSWORD_FIELD_BLOCKED/);
  assert.match(windowsUiActions, /Test-Sensitive/);
  assert.doesNotMatch(windowsUi, /Start-Process\s+.+-Verb\s+RunAs/i);
  assert.doesNotMatch(windowsUiActions, /ExecutionPolicy.*Bypass/i);
});

test('ui_hotkey uses native SendInput and reports elevation mismatch', () => {
  assert.match(windowsHotkey, /SendInput/);
  assert.match(windowsHotkey, /PC_UI_PRIVILEGE_MISMATCH:TARGET_ELEVATED/);
  assert.match(windowsHotkey, /PC_UI_HOTKEY_SENDINPUT_FAILED/);
  assert.doesNotMatch(windowsHotkey, /System\.Windows\.Forms\.SendKeys/);
});

test('desktop agent exposes full app-control primitives without arbitrary shell tool', () => {
  const names = PC_DESKTOP_TOOL_DECLARATIONS.map(tool => tool.name);
  for (const required of [
    'pc_screen_analyze','pc_ui_tree','pc_ui_click_text','pc_ui_action','pc_screen_click',
    'pc_window_list','pc_window_focus','pc_window_close','pc_window_state','pc_window_move_resize',
    'pc_browser_snapshot','pc_browser_click','pc_agent_task','pc_clipboard_read','pc_clipboard_write'
  ]) assert.ok(names.includes(required), required);
  assert.match(toolCore, /OBSERVE.*AJA.*VERIFIQUE/i);
  assert.match(windowControl, /EnumWindows/);
  assert.match(windowControl, /SetWindowPos/);
  assert.match(windowControl, /PostMessage/);
  assert.match(agent, /screen_analyze/);
  assert.match(agent, /window_close/);
  assert.match(agent, /ui_action/);
  assert.doesNotMatch(agent, /action === ['"]shell['"]/);
  assert.doesNotMatch(agent, /action === ['"]exec['"]/);
});
