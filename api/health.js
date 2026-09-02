import { modeInfo, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  send(res, 200, { ok: true, version: '2.1.0-voice-core-v6', ...modeInfo() });
}
