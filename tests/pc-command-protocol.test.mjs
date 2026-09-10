import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeDesktopCommand, encodeDesktopCommand, PC_COMMAND_PROTOCOL_VERSION, PC_COMMAND_TRANSPORT_ACTION } from '../lib/pc-command-protocol.mjs';

test('Hands/Browser usam envelope interno restrito', () => {
  const encoded = encodeDesktopCommand('ui_tree', { maxNodes: 80 });
  assert.equal(encoded.action, PC_COMMAND_TRANSPORT_ACTION);
  assert.equal(encoded.payload._sextaDesktopProtocol, PC_COMMAND_PROTOCOL_VERSION);
  const decoded = decodeDesktopCommand(encoded.action, encoded.payload);
  assert.deepEqual(decoded, { action: 'ui_tree', payload: { maxNodes: 80 } });
});

test('controle v2 trafega somente ações explicitamente registradas', () => {
  for (const action of ['window_close','window_state','window_move_resize','ui_action','screen_click_point']) {
    const encoded = encodeDesktopCommand(action, { marker: action });
    assert.deepEqual(decodeDesktopCommand(encoded.action, encoded.payload), { action, payload: { marker: action } });
  }
});

test('ações fora do protocolo não entram no envelope', () => {
  assert.throws(() => encodeDesktopCommand('shell', { command: 'whoami' }), /PC_COMMAND_PROTOCOL_ACTION_BLOCKED/);
  assert.throws(() => encodeDesktopCommand('exec', {}), /PC_COMMAND_PROTOCOL_ACTION_BLOCKED/);
  assert.throws(() => encodeDesktopCommand('process_kill', {}), /PC_COMMAND_PROTOCOL_ACTION_BLOCKED/);
});

test('envelope adulterado é rejeitado', () => {
  assert.throws(() => decodeDesktopCommand('git_status', { _sextaDesktopProtocol: PC_COMMAND_PROTOCOL_VERSION, _sextaDesktopAction: 'shell', data: {} }), /PC_COMMAND_PROTOCOL_ACTION_BLOCKED/);
  assert.equal(decodeDesktopCommand('git_status', { _sextaDesktopProtocol: PC_COMMAND_PROTOCOL_VERSION - 1, _sextaDesktopAction: 'ui_tree', data: {} }), null);
  assert.equal(decodeDesktopCommand('open_url', {}), null);
});
