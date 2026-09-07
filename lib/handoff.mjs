import { addEvent, getDevices, getEvents, queueCommand } from './core.mjs';

export const HANDOFF_VERSION = '1.0.0';
const SAFE_HANDOFF_ACTIONS = new Set(['open_url', 'open_project', 'open_app']);

function matchesTarget(device, target) {
  const kind = String(device.kind || '').toLowerCase();
  const context = device.context && typeof device.context === 'object' ? device.context : {};
  if (target === 'pc') return device.online && (kind === 'agent' || kind === 'desktop' || context.pcAgent === true);
  if (target === 'android') return device.online && (kind === 'android' || context.android === true);
  if (target === 'browser') return device.online && (kind === 'browser' || kind === 'web');
  return device.online;
}

export async function createHandoff({ fromDeviceId = '', target = 'pc', summary = '', action = null } = {}) {
  const devices = await getDevices();
  const targetDevice = devices.find(device => matchesTarget(device, String(target || 'pc').toLowerCase())) || null;
  if (!targetDevice) throw new Error('HANDOFF_TARGET_OFFLINE');
  const cleanSummary = String(summary || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
  if (!cleanSummary) throw new Error('HANDOFF_SUMMARY_REQUIRED');
  let command = null;
  if (action?.name) {
    const name = String(action.name || '');
    if (!SAFE_HANDOFF_ACTIONS.has(name)) throw new Error('HANDOFF_ACTION_BLOCKED');
    command = await queueCommand(targetDevice.device_id, name, action.args && typeof action.args === 'object' ? action.args : {});
  }
  const event = await addEvent({
    sourceDeviceId: fromDeviceId || null,
    level: 'info',
    title: `Handoff → ${targetDevice.name || target}`,
    body: cleanSummary,
    metadata: { kind: 'handoff', version: HANDOFF_VERSION, fromDeviceId: fromDeviceId || null, targetDeviceId: targetDevice.device_id, target, commandId: command?.id || null }
  });
  return { version: HANDOFF_VERSION, eventId: event.id, target: { deviceId: targetDevice.device_id, name: targetDevice.name, kind: targetDevice.kind }, commandId: command?.id || null, summary: cleanSummary };
}

export async function listHandoffs(limit = 20) {
  const events = await getEvents(Math.max(20, Math.min(100, Number(limit) || 20)));
  return events.filter(event => event?.metadata?.kind === 'handoff').slice(0, limit);
}
