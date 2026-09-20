import { getCommand, queueCommand } from '../core.mjs';
import { addMissionStep, getMission, hydrateMission, updateMission } from './missions.mjs';
import { loadMission, persistMission } from './mission-persistence.mjs';

export async function dispatchMissionCommand({ missionId, targetDeviceId, action, payload = {} }) {
  const mission = getMission(missionId);
  if (!mission) throw new Error('MISSION_NOT_FOUND');
  if (!targetDeviceId) throw new Error('MISSION_TARGET_REQUIRED');

  const commandPayload = {
    ...payload,
    _sexta: {
      ...(payload?._sexta || {}),
      missionId
    }
  };

  const command = await queueCommand(targetDeviceId, action, commandPayload);

  const updated = addMissionStep(missionId, {
    title: `Executar ${action}`,
    status: 'running',
    detail: { commandId: command.id, targetDeviceId }
  });

  const running = updateMission(missionId, {
    status: 'running',
    assignedDeviceId: targetDeviceId,
    context: {
      ...(updated.context || {}),
      activeCommandId: command.id
    }
  });

  await persistMission(running);
  return { mission: running, command };
}

export async function applyCommandResultToMission({ commandId, status, result, message = '' }) {
  if (!commandId) return null;
  const command = await getCommand(commandId);
  const missionId = command?.payload?._sexta?.missionId;
  if (!missionId) return null;

  let mission = getMission(missionId);
  if (!mission) {
    const persisted = await loadMission(missionId);
    if (persisted) mission = hydrateMission(persisted);
  }
  if (!mission) return null;

  const terminal = status === 'done' || status === 'failed';
  const missionStatus = status === 'done' ? 'completed' : status === 'failed' ? 'failed' : 'running';

  const steps = Array.isArray(mission.steps)
    ? mission.steps.map(step => {
        if (step?.detail?.commandId !== commandId) return step;
        return {
          ...step,
          status: status === 'done' ? 'completed' : status === 'failed' ? 'failed' : 'running',
          completedAt: terminal ? new Date().toISOString() : step.completedAt || null,
          detail: {
            ...(step.detail || {}),
            result: terminal ? result : step.detail?.result,
            message: message || step.detail?.message || null
          }
        };
      })
    : [];

  const updated = updateMission(missionId, {
    status: missionStatus,
    steps,
    result: status === 'done' ? result : mission.result,
    error: status === 'failed'
      ? { code: result?.error || 'COMMAND_FAILED', message: message || result?.message || 'Falha durante a execução.' }
      : null
  });

  await persistMission(updated);
  return updated;
}
