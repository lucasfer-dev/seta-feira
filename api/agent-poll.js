import { isAgent, pollCommands, send, updateCommand } from '../lib/core.mjs';

const STALE_MS = 2 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isAgent(req)) return send(res, 401, { error: 'unauthorized' });
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('deviceId');
  if (!deviceId) return send(res, 400, { error: 'device_id_required' });

  try {
    const queued = await pollCommands(deviceId);
    const commands = [];
    const now = Date.now();

    for (const command of queued) {
      const age = now - new Date(command.created_at || 0).getTime();
      if (Number.isFinite(age) && age > STALE_MS) {
        await updateCommand(command.id, 'failed', { message: 'COMMAND_EXPIRED_BEFORE_PC_PICKUP', expired: true });
        continue;
      }
      await updateCommand(command.id, 'running', null);
      commands.push(command);
    }

    return send(res, 200, { commands });
  } catch (error) {
    return send(res, 500, { error: 'poll_failed', message: error.message });
  }
}
