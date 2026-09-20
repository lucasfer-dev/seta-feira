import { isOwner, parseJson, send } from '../../lib/core.mjs';
import { setHomeHubOffline, setHomeHubOnline } from '../../lib/v2/home-hub.mjs';

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await parseJson(req);
  try {
    const device = body.online === false
      ? setHomeHubOffline(body.deviceId || 'home-hub')
      : setHomeHubOnline({
          deviceId: body.deviceId || 'home-hub',
          name: body.name || 'SEXTA Home Hub',
          capabilities: body.capabilities || []
        });
    return send(res, 200, { device });
  } catch (error) {
    return send(res, 400, { error: 'home_hub_failed', message: error.message });
  }
}
