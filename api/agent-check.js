import { send } from '../lib/core.mjs';
import { agentTokenInfo, isAgentRequest, requestDeviceId } from '../lib/agent-auth.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const deviceId = requestDeviceId(req);
  if (!isAgentRequest(req, deviceId)) return send(res, 401, { error: 'unauthorized' });
  const token = agentTokenInfo(req);
  return send(res, 200, {
    ok: true,
    protocol: 3,
    deviceId: token?.deviceId || deviceId || 'legacy-agent',
    tokenType: token ? 'paired-device' : 'legacy-shared',
    serverTime: new Date().toISOString()
  });
}
