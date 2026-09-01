import { getSettings, isOwner, parseJson, saveSettings, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    if (req.method === 'GET') return send(res, 200, { settings: await getSettings() });
    if (req.method === 'POST') return send(res, 200, { settings: await saveSettings(await parseJson(req)) });
    send(res, 405, { error: 'method_not_allowed' });
  } catch (error) { send(res, 500, { error: 'settings_failed', message: error.message }); }
}
