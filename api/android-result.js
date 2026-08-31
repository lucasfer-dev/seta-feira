import { addEvent, isOwner, parseJson, send, updateCommand } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  const body = await parseJson(req);
  try {
    const status = body.ok ? 'done' : 'failed';
    await updateCommand(String(body.commandId || ''), status, body.result || {});
    await addEvent({
      sourceDeviceId: body.deviceId,
      level: body.ok ? 'success' : 'error',
      title: body.ok ? `Android concluiu: ${body.action || 'comando'}` : `Android falhou: ${body.action || 'comando'}`,
      body: body.message || '',
      metadata: { commandId: body.commandId, result: body.result || {} }
    });
    return send(res, 200, { ok: true });
  } catch (error) {
    return send(res, 500, { error: 'android_result_failed', message: error.message });
  }
}
