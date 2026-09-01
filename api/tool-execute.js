import { isOwner, parseJson, send } from '../lib/core.mjs';
import { executeTool } from '../lib/tool-bus.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req).catch(() => ({}));
  const name = String(body.name || '').trim().slice(0, 128);
  const args = body.args && typeof body.args === 'object' ? body.args : {};
  const deviceId = String(body.deviceId || '').trim().slice(0, 120);
  if (!name) return send(res, 400, { error: 'tool_name_required' });

  try {
    const result = await executeTool(name, args, {
      preferLocalAndroid: Boolean(body.preferLocalAndroid),
      deviceId
    });
    return send(res, 200, result);
  } catch (error) {
    console.error('[SEXTA ToolBus]', name, error);
    return send(res, 200, {
      ok: false,
      handled: true,
      tool: name,
      error: String(error?.message || error || 'TOOL_FAILED').slice(0, 700)
    });
  }
}
