import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateToolPolicy, getToolPolicy } from '../lib/tool-policy.mjs';

const accessibility = fs.readFileSync(new URL('../apps/android-capacitor/native/java/SextaAccessibilityService.java', import.meta.url), 'utf8');
const prepareHands = fs.readFileSync(new URL('../apps/android-capacitor/scripts/prepare-hands.mjs', import.meta.url), 'utf8');

test('screen inspection requires current-turn intent', () => {
  const blocked = evaluateToolPolicy('android_ui_snapshot', {}, {
    enforceExplicit: true,
    userText: 'bom dia sexta'
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'EXPLICIT_USER_ACTION_REQUIRED');

  const allowed = evaluateToolPolicy('android_ui_snapshot', {}, {
    enforceExplicit: true,
    userText: 'olha o que tem na minha tela'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.sideEffect, 'screen-read');
});

test('hands navigation requires an explicit navigation task', () => {
  const blocked = evaluateToolPolicy('android_ui_tap_text', { text: 'Configurações' }, {
    enforceExplicit: true,
    userText: 'como funciona o android?'
  });
  assert.equal(blocked.allowed, false);

  const allowed = evaluateToolPolicy('android_ui_tap_text', { text: 'Configurações' }, {
    enforceExplicit: true,
    userText: 'abre o app e clica em Configurações'
  });
  assert.equal(allowed.allowed, true);
  assert.equal(getToolPolicy('android_ui_tap_text').risk, 'medium');
});

test('native accessibility layer blocks generic sensitive final controls', () => {
  for (const word of ['enviar', 'pagar', 'comprar', 'confirmar', 'excluir', 'publicar', 'transferir']) {
    assert.match(accessibility, new RegExp(word, 'i'));
  }
  assert.match(accessibility, /ANDROID_UI_SENSITIVE_CONTROL_BLOCKED/);
  assert.doesNotMatch(accessibility, /dispatchGesture\s*\(/);
  assert.doesNotMatch(accessibility, /ACTION_SET_TEXT/);
});

test('Hands v1 enables tree retrieval only in the explicit build preparation step', () => {
  assert.match(prepareHands, /canRetrieveWindowContent="true"/);
  assert.match(prepareHands, /flagReportViewIds\|flagRetrieveInteractiveWindows/);
  assert.match(prepareHands, /ui_snapshot/);
  assert.match(prepareHands, /AndroidHandsExecutor/);
});
