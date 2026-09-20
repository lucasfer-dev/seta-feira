import { isOwner, parseJson, send } from '../../lib/core.mjs';
import { orchestrator } from '../../lib/v2/orchestrator.mjs';
import { addMissionStep, cancelMission, getMission, listMissions, updateMission } from '../../lib/v2/missions.mjs';

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const mission = getMission(id);
        return mission ? send(res, 200, { mission }) : send(res, 404, { error: 'mission_not_found' });
      }
      return send(res, 200, { missions: listMissions({ status: url.searchParams.get('status') || undefined }) });
    }

    const body = await parseJson(req);

    if (req.method === 'POST') {
      const mission = orchestrator.createMission({
        goal: body.goal,
        sourceDeviceId: body.sourceDeviceId || null,
        context: body.context || {},
        requiredCapability: body.requiredCapability || null
      });
      const routed = body.route === false ? mission : orchestrator.routeMission(mission.id);
      return send(res, 201, { mission: routed });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return send(res, 400, { error: 'mission_id_required' });
      if (body.action === 'cancel') return send(res, 200, { mission: cancelMission(id) });
      if (body.step) return send(res, 200, { mission: addMissionStep(id, body.step) });
      return send(res, 200, { mission: updateMission(id, body.patch || {}) });
    }

    return send(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    const status = ['MISSION_NOT_FOUND'].includes(error.message) ? 404 : 400;
    return send(res, status, { error: 'mission_failed', message: error.message });
  }
}
