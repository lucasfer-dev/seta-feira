import { modeInfo, send } from '../lib/core.mjs';
import { getHealthSnapshot } from '../lib/v2/observability.mjs';
import { versionSnapshot } from '../lib/v2/version.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const versions = versionSnapshot();
  send(res, 200, {
    ok: true,
    versions,
    liveModel: 'gemini-3.1-flash-live-preview',
    voice: {
      realtime: 'gemini-live',
      wake: 'resident-runtime',
      systemSpeech: 'compatibility-fallback'
    },
    components: getHealthSnapshot(),
    intelligence: {
      orchestrator: 'v2-canonical',
      reflexEngine: true,
      capabilityRegistry: true,
      missionEngine: true,
      worldState: versions.worldState,
      deviceProtocol: versions.deviceProtocol,
      browserAgent: true,
      memoryLayers: ['working', 'session', 'episodic', 'semantic', 'procedural', 'vault'],
      cronConfigured: true,
      cronStrongAuth: Boolean(process.env.CRON_SECRET)
    },
    ...modeInfo()
  });
}
