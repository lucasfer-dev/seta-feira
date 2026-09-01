import test from 'node:test';
import assert from 'node:assert/strict';

import { executeTool, isSensitiveTool } from '../lib/tool-bus.mjs';

test('classifica somente ações externas sensíveis', () => {
  assert.equal(isSensitiveTool('google_send_email'), true);
  assert.equal(isSensitiveTool('android_reply_notification'), true);
  assert.equal(isSensitiveTool('pc_codex_task', { mode: 'edit' }), true);
  assert.equal(isSensitiveTool('pc_codex_task', { mode: 'analyze' }), false);
  assert.equal(isSensitiveTool('android_open_app'), false);
});

test('ação sensível é proposta sem executar', async () => {
  const proposed = await executeTool('google_send_email', {
    recipient: 'teste@example.com',
    subject: 'Teste',
    body: 'Não deve ser enviado durante o teste.'
  });
  assert.equal(proposed.state, 'confirmation_required');
  assert.equal(proposed.confirmationRequired, true);
  assert.ok(proposed.confirmationId);

  const canceled = await executeTool('cancel_action', { confirmationId: proposed.confirmationId });
  assert.equal(canceled.state, 'canceled');
});

test('confirmação executa uma vez e repetição reutiliza o resultado', async () => {
  const proposal = await executeTool('android_reply_notification', {
    app: 'whatsapp', recipient: 'Teste', text: 'Olá'
  }, { preferLocalAndroid: true, deviceId: 'android-test' });

  const confirmed = await executeTool('confirm_action', { confirmationId: proposal.confirmationId });
  assert.equal(confirmed.state, 'ready_for_local_execution');
  assert.equal(confirmed.clientAction.action, 'notification_reply');
  assert.equal(confirmed.confirmed, true);

  const replay = await executeTool('confirm_action', { confirmationId: proposal.confirmationId });
  assert.equal(replay.state, 'ready_for_local_execution');
  assert.equal(replay.replayed, true);
});
