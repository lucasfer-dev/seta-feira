import { modeInfo, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  send(res, 200, {
    ok: true,
    version: '3.1.0-voice-core-v10-personality-v2',
    voiceCore: 'v10',
    liveModel: 'gemini-3.1-flash-live-preview',
    vadMode: 'manual-local',
    personality: '2.0.0-canonical-operational',
    ...modeInfo()
  });
}
