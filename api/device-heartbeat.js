import { heartbeat, isOwner, parseJson, send } from '../lib/core.mjs';
import { isAgentRequest } from '../lib/agent-auth.mjs';
import { orchestrator } from '../lib/v2/orchestrator.mjs';
import { normalizeCapabilities } from '../lib/v2/device-capabilities.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await parseJson(req);
  if (!body.deviceId) return send(res, 400, { error: 'device_id_required' });
  if (!isOwner(req) && !isAgentRequest(req, String(body.deviceId))) return send(res, 401, { error: 'unauthorized' });
  try {
    const device = await heartbeat(body);
    orchestrator.registerDevice({
      id: device.device_id,
      name: device.name,
      kind: device.kind,
      capabilities: normalizeCapabilities(device.kind, device.capabilities),
      context: device.context,
      online: true,
      active: Boolean(body.active)
    });
    send(res, 200, { device });
  } catch (error) { send(res, 500, { error: 'heartbeat_failed', message: error.message }); }
}
