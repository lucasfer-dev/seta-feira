import { isOwner, send } from '../../lib/core.mjs';
import { orchestrator } from '../../lib/v2/orchestrator.mjs';

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  return send(res, 200, { state: orchestrator.snapshot() });
}
