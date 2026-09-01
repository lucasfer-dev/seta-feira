import { addEvent, isAgent, parseJson, send, updateCommand } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isAgent(req)) return send(res, 401, { error: 'unauthorized' });
  const body = await parseJson(req);
  try {
    const requestedStatus = String(body.status || '').toLowerCase();
    const status = ['running', 'done', 'failed'].includes(requestedStatus)
      ? requestedStatus
      : (body.ok ? 'done' : 'failed');

    await updateCommand(String(body.commandId || ''), status, body.result || {});

    if (status !== 'running') {
      await addEvent({
        sourceDeviceId: body.deviceId,
        level: status === 'done' ? 'success' : 'error',
        title: status === 'done' ? `Ação concluída: ${body.action || 'comando'}` : `Falha: ${body.action || 'comando'}`,
        body: body.message || '',
        metadata: { commandId: body.commandId, result: body.result || {} }
      });
    }

    send(res, 200, { ok: true, status });
  } catch (error) {
    send(res, 500, { error: 'result_failed', message: error.message });
  }
}
