import { heartbeat, isAgent, isOwner, parseJson, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req) && !isAgent(req)) return send(res, 401, { error: 'unauthorized' });
  const body = await parseJson(req);
  if (!body.deviceId) return send(res, 400, { error: 'device_id_required' });
  try { send(res, 200, { device: await heartbeat(body) }); }
  catch (error) { send(res, 500, { error: 'heartbeat_failed', message: error.message }); }
}
