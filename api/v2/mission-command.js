import { getDevices, isOwner, parseJson, send } from '../../lib/core.mjs';
import { getMission, hydrateMission } from '../../lib/v2/missions.mjs';
import { loadMission } from '../../lib/v2/mission-persistence.mjs';
import { dispatchMissionCommand } from '../../lib/v2/mission-runtime.mjs';

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  try {
    const body = await parseJson(req);
    const missionId = String(body.missionId || '');
    if (!missionId) return send(res, 400, { error: 'mission_id_required' });

    let mission = getMission(missionId);
    if (!mission) {
      const persisted = await loadMission(missionId);
      if (persisted) mission = hydrateMission(persisted);
    }
    if (!mission) return send(res, 404, { error: 'mission_not_found' });

    let targetDeviceId = body.targetDeviceId || mission.assignedDeviceId || null;
    if (!targetDeviceId) {
      const devices = await getDevices();
      targetDeviceId = devices.find(d => d.online && ['agent','desktop'].includes(d.kind))?.device_id || null;
    }
    if (!targetDeviceId) return send(res, 409, { error: 'no_desktop_online' });

    const result = await dispatchMissionCommand({
      missionId,
      targetDeviceId,
      action: String(body.action || ''),
      payload: body.payload || {}
    });

    return send(res, 201, result);
  } catch (error) {
    const status = error.message === 'ACTION_NOT_ALLOWED' ? 400
      : error.message === 'MISSION_NOT_FOUND' ? 404
      : 500;
    return send(res, status, { error: 'mission_command_failed', message: error.message });
  }
}
