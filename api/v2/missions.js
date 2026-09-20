import { isOwner, parseJson, send } from '../../lib/core.mjs';
import { orchestrator } from '../../lib/v2/orchestrator.mjs';
import { addMissionStep, cancelMission, getMission, hydrateMission, listMissions, updateMission } from '../../lib/v2/missions.mjs';
import { loadMission, loadMissions, persistMission } from '../../lib/v2/mission-persistence.mjs';

async function ensureMission(id) {
  return getMission(id) || hydrateMission(await loadMission(id));
}

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  try {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id) {
        const mission = await ensureMission(id);
        return mission ? send(res, 200, { mission }) : send(res, 404, { error: 'mission_not_found' });
      }

      const status = url.searchParams.get('status') || undefined;
      const persisted = await loadMissions({ status });
      for (const mission of persisted) hydrateMission(mission);
      return send(res, 200, { missions: listMissions({ status }) });
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
      await persistMission(routed);
      return send(res, 201, { mission: routed });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return send(res, 400, { error: 'mission_id_required' });
      const existing = await ensureMission(id);
      if (!existing) return send(res, 404, { error: 'mission_not_found' });

      let mission;
      if (body.action === 'cancel') mission = cancelMission(id);
      else if (body.step) mission = addMissionStep(id, body.step);
      else mission = updateMission(id, body.patch || {});

      await persistMission(mission);
      return send(res, 200, { mission });
    }

    return send(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    const status = ['MISSION_NOT_FOUND'].includes(error.message) ? 404 : 400;
    return send(res, status, { error: 'mission_failed', message: error.message });
  }
}
