import { getDevices, isOwner, parseJson, queueCommand, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await parseJson(req);
  try {
    let target = body.targetDeviceId;
    if (!target) {
      const devices = await getDevices();
      target = devices.find(d => d.online && ['agent','desktop'].includes(d.kind))?.device_id;
    }
    if (!target) return send(res, 409, { error: 'no_desktop_online' });
    const command = await queueCommand(target, String(body.action || ''), body.payload || {});
    send(res, 200, { command });
  } catch (error) {
    const status = error.message === 'ACTION_NOT_ALLOWED' ? 400 : 500;
    send(res, status, { error: 'command_failed', message: error.message });
  }
}
