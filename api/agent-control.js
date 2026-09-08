import { getDevices, isOwner, parseJson, queueCommand, send } from '../lib/core.mjs';
import { encodeDesktopCommand } from '../lib/pc-command-protocol.mjs';

const AUTONOMY = new Set(['observer', 'assistant', 'autonomous']);
const CONTROL_OPS = new Set(['pause', 'resume', 'cancel', 'set_autonomy', 'set_privacy']);
const PRIVACY_KEYS = ['screen', 'clipboard', 'uiAutomation', 'browser', 'hardware'];

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = await parseJson(req);
  const op = String(body.op || '').trim();
  if (!CONTROL_OPS.has(op)) return send(res, 400, { error: 'control_op_invalid' });

  let targetDeviceId = String(body.targetDeviceId || '').trim();
  if (!targetDeviceId) {
    const devices = await getDevices();
    targetDeviceId = devices.find(d => d.online && ['agent', 'desktop'].includes(String(d.kind || '').toLowerCase()))?.device_id || '';
  }
  if (!targetDeviceId) return send(res, 409, { error: 'no_pc_agent_online' });

  const payload = { op };
  if (op === 'set_autonomy') {
    const value = String(body.value || '');
    if (!AUTONOMY.has(value)) return send(res, 400, { error: 'autonomy_invalid' });
    payload.value = value;
  }
  if (op === 'set_privacy') {
    const value = body.value && typeof body.value === 'object' ? body.value : {};
    payload.value = {};
    for (const key of PRIVACY_KEYS) {
      if (typeof value[key] === 'boolean') payload.value[key] = value[key];
    }
    if (!Object.keys(payload.value).length) return send(res, 400, { error: 'privacy_value_required' });
  }

  try {
    const transport = encodeDesktopCommand('agent_control', payload);
    const command = await queueCommand(targetDeviceId, transport.action, transport.payload);
    return send(res, 200, { ok: true, command: { ...command, action: 'agent_control' } });
  } catch (error) {
    return send(res, 500, { error: 'agent_control_failed', message: String(error?.message || error) });
  }
}
