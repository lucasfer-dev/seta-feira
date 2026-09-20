import { events } from './event-bus.mjs';
import { getWorldState, patchWorldState, updateDeviceState } from './world-state.mjs';
import { chooseDevice } from './device-capabilities.mjs';
import { createMission, getMission, updateMission } from './missions.mjs';

class SextaOrchestrator {
  registerDevice(device) {
    if (!device?.id) throw new Error('DEVICE_ID_REQUIRED');
    return updateDeviceState(device.id, {
      ...device,
      online: device.online ?? true,
      lastSeenAt: new Date().toISOString()
    });
  }

  recordConversation({ userText, assistantText, intent, topic } = {}) {
    const patch = {};
    if (userText !== undefined) patch.lastUserText = userText;
    if (assistantText !== undefined) patch.lastAssistantText = assistantText;
    if (intent !== undefined) patch.lastIntent = intent;
    if (topic !== undefined) patch.currentTopic = topic;
    return patchWorldState({ conversation: patch }, 'conversation');
  }

  createMission(input) {
    return createMission(input);
  }

  routeMission(missionId) {
    const full = getMission(missionId);
    if (!full) throw new Error('MISSION_NOT_FOUND');

    const world = getWorldState();
    const devices = Object.values(world.devices);
    const requiredCapability = full.requiredCapability || null;

    if (!requiredCapability) return updateMission(missionId, { status: 'running' });

    const device = chooseDevice(devices, requiredCapability, full.sourceDeviceId);
    if (!device) return updateMission(missionId, { status: 'waiting_for_device', assignedDeviceId: null });

    return updateMission(missionId, { status: 'running', assignedDeviceId: device.id });
  }

  snapshot() {
    return getWorldState();
  }
}

export const orchestrator = new SextaOrchestrator();

events.on('mission.updated', event => {
  if (event.payload?.status === 'completed') {
    patchWorldState({ conversation: { currentTopic: event.payload?.goal || null } }, 'mission.completed');
  }
});
