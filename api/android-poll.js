import { isOwner, pollCommands, send, updateCommand } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('deviceId');
  if (!deviceId) return send(res, 400, { error: 'device_id_required' });
  try {
    const commands = await pollCommands(deviceId);
    for (const command of commands) await updateCommand(command.id, 'running', null);
    return send(res, 200, { commands });
  } catch (error) {
    return send(res, 500, { error: 'android_poll_failed', message: error.message });
  }
}
