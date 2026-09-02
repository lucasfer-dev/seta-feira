import { modeInfo, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  send(res, 200, {
    ok: true,
    version: '2.4.2-voice-core-v9.2',
    voiceCore: 'v9.2',
    liveModel: 'gemini-3.1-flash-live-preview',
    vadMode: 'automatic-server',
    ...modeInfo()
  });
}
