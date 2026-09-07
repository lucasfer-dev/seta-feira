import { isOwner, send } from '../lib/core.mjs';
import { getToolCoreStatus } from '../lib/tool-core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    const status = await getToolCoreStatus();
    return send(res, 200, { ok: true, ...status });
  } catch (error) {
    return send(res, 503, {
      ok: false,
      error: 'tool_registry_unavailable',
      message: String(error?.message || error).slice(0, 500)
    });
  }
}
