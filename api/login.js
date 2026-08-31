import { config, createOwnerToken, parseJson, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const c = config();
  const body = await parseJson(req);
  if (!c.pin) {
    if (c.supabaseUrl && c.supabaseKey) return send(res, 503, { error: 'cloud_requires_access_pin' });
    return send(res, 200, { token: 'demo-owner', demo: true });
  }
  if (String(body.pin || '') !== c.pin) return send(res, 401, { error: 'invalid_pin' });
  send(res, 200, { token: createOwnerToken(), demo: false });
}
