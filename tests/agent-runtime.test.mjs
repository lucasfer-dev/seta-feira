import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const statePath = path.join(os.tmpdir(), `sexta-agent-state-${process.pid}-${Date.now()}.json`);
process.env.SEXTA_AGENT_STATE = statePath;
const runtime = await import(`../agent/runtime-state.mjs?test=${Date.now()}`);

test.after(() => { try { fs.unlinkSync(statePath); } catch {} });

test('observer é read-only', () => {
  const state = runtime.writeRuntimeState({ autonomy: 'observer', paused: false });
  assert.equal(runtime.evaluateLocalAction('window_list', {}, state).allowed, true);
  assert.equal(runtime.evaluateLocalAction('open_app', {}, state).allowed, false);
});

test('privacy desliga sensores locais de verdade', () => {
  const state = runtime.writeRuntimeState({ autonomy: 'assistant', privacy: { screen: false, clipboard: false, uiAutomation: false, browser: false } });
  assert.equal(runtime.evaluateLocalAction('screen_analyze', {}, state).reason, 'PRIVACY_SCREEN_DISABLED');
  assert.equal(runtime.evaluateLocalAction('read_clipboard', {}, state).reason, 'PRIVACY_CLIPBOARD_DISABLED');
  assert.equal(runtime.evaluateLocalAction('ui_tree', {}, state).reason, 'PRIVACY_UI_AUTOMATION_DISABLED');
  assert.equal(runtime.evaluateLocalAction('browser_snapshot', {}, state).reason, 'PRIVACY_BROWSER_DISABLED');
});

test('kill switch pausa tudo exceto controle', () => {
  const state = runtime.writeRuntimeState({ paused: true, privacy: { screen: true, clipboard: true, uiAutomation: true, browser: true } });
  assert.equal(runtime.evaluateLocalAction('get_system_info', {}, state).reason, 'AGENT_PAUSED');
  assert.equal(runtime.evaluateLocalAction('agent_control', {}, state).allowed, true);
});

test('ações internas multi-step exigem modo autonomous', () => {
  const assistant = runtime.writeRuntimeState({ paused: false, autonomy: 'assistant' });
  assert.equal(runtime.evaluateLocalAction('browser_snapshot', { _sextaAgentTask: true }, assistant).reason, 'AUTONOMOUS_MODE_REQUIRED');
  const autonomous = runtime.writeRuntimeState({ autonomy: 'autonomous' });
  assert.equal(runtime.evaluateLocalAction('browser_snapshot', { _sextaAgentTask: true }, autonomous).allowed, true);
});
