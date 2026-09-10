import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const control = fs.readFileSync(new URL('../agent/windows-control-v2.mjs', import.meta.url), 'utf8');
const protocol = fs.readFileSync(new URL('../lib/pc-command-protocol.mjs', import.meta.url), 'utf8');

test('window control v2 uses real HWND enumeration and verification', () => {
  assert.match(control, /EnumWindows/);
  assert.match(control, /GetForegroundWindow/);
  assert.match(control, /ShowWindowAsync/);
  assert.match(control, /SetForegroundWindow/);
  assert.match(control, /AttachThreadInput/);
  assert.match(control, /PC_WINDOW_FOCUS_NOT_VERIFIED/);
});

test('window control v2 supports close, state and move-resize', () => {
  assert.match(control, /PostMessage\(\$h,0x0010/);
  assert.match(control, /SetWindowPos/);
  assert.match(control, /minimize/);
  assert.match(control, /maximize/);
  assert.match(control, /PC_WINDOW_CLOSE_NOT_VERIFIED/);
  assert.match(control, /PC_WINDOW_MOVE_NOT_VERIFIED/);
});

test('desktop protocol exposes full window operations', () => {
  for (const action of ['window_list', 'window_focus', 'window_close', 'window_state', 'window_move_resize']) {
    assert.match(protocol, new RegExp(`['\"]${action}['\"]`));
  }
});
