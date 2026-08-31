import { isAgent, pollCommands, send, updateCommand } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isAgent(req)) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('deviceId');
  if (!deviceId) return send(res, 400, { error: 'device_id_required' });
  try {
    const commands = await pollCommands(deviceId);
    for (const c of commands) await updateCommand(c.id, 'running', null);
    send(res, 200, { commands });
  } catch (error) { send(res, 500, { error: 'poll_failed', message: error.message }); }
}
