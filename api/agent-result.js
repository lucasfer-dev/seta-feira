import { addEvent, parseJson, send, updateCommand } from '../lib/core.mjs';
import { isAgentRequest } from '../lib/agent-auth.mjs';

function normalizeResult(result = {}) {
  const value = result && typeof result === 'object' ? result : {};
  const unverified = value.verified === false;
  const failed = value.ok === false || String(value.state || '').toLowerCase() === 'failed' || Boolean(value.error) || unverified;
  if (!failed) return { value, failed: false, unverified: false };
  return {
    value: {
      ...value,
      ...(unverified ? {
        verificationRequired: true,
        error: value.error || 'PC_ACTION_NOT_VERIFIED'
      } : {})
    },
    failed: true,
    unverified
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await parseJson(req);
  const deviceId = String(body.deviceId || '').trim();
  if (!deviceId) return send(res, 400, { error: 'device_id_required' });
  if (!isAgentRequest(req, deviceId)) return send(res, 401, { error: 'unauthorized' });
  try {
    const normalized = normalizeResult(body.result || {});
    const requestedStatus = String(body.status || '').toLowerCase();
    let status = ['running', 'done', 'failed'].includes(requestedStatus)
      ? requestedStatus
      : (body.ok ? 'done' : 'failed');

    // The Windows agent is not allowed to turn a returned failure or an
    // explicitly unverified action into a successful cloud command merely by
    // posting status=done. OBSERVE -> ACT -> VERIFY remains authoritative.
    if (status !== 'running' && (normalized.failed || body.ok === false)) status = 'failed';

    await updateCommand(String(body.commandId || ''), status, normalized.value);

    if (status !== 'running') {
      const message = normalized.unverified
        ? (body.message ? `${body.message} A ação não teve verificação suficiente.` : 'A ação não teve verificação suficiente e precisa ser observada novamente.')
        : (body.message || '');
      await addEvent({
        sourceDeviceId: body.deviceId,
        level: status === 'done' ? 'success' : 'error',
        title: status === 'done' ? `Ação concluída: ${body.action || 'comando'}` : `Falha: ${body.action || 'comando'}`,
        body: message,
        metadata: { commandId: body.commandId, result: normalized.value, verificationRequired: normalized.unverified }
      });
    }

    send(res, 200, { ok: true, status, verificationRequired: normalized.unverified });
  } catch (error) {
    send(res, 500, { error: 'result_failed', message: error.message });
  }
}
