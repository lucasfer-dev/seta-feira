import { modeInfo, send } from '../lib/core.mjs';
import { openaiPlannerStatus } from '../lib/openai-planner.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  const planner = openaiPlannerStatus();
  send(res, 200, {
    ok: true,
    version: '1.3.0-obsidian-memory',
    ...modeInfo(),
    hybridPlanner: {
      configured: planner.configured,
      model: planner.model,
      reasoningEffort: planner.reasoningEffort
    }
  });
}
