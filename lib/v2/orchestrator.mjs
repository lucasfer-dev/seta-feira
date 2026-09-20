import { events } from './event-bus.mjs';
import { getWorldState, patchWorldState, updateDeviceState } from './world-state.mjs';
import { chooseDevice, inferRequiredCapability } from './device-capabilities.mjs';
import { createMission, getMission, updateMission } from './missions.mjs';
import { detectReflex } from './reflex-engine.mjs';
import { executeCapability, getCapability } from './capability-registry.mjs';
import { createTrace, observedAction } from './observability.mjs';
import { sextaError } from './errors.mjs';

class SextaOrchestrator {
  registerDevice(device) {
    if (!device?.id) throw sextaError('DEVICE_ID_REQUIRED', 'Dispositivo sem id.');
    return updateDeviceState(device.id, {
      ...device,
      online: device.online ?? true,
      lastSeenAt: new Date().toISOString()
    });
  }

  recordConversation({ userText, assistantText, intent, topic, lastObject } = {}) {
    const patch = {};
    if (userText !== undefined) patch.lastUserText = userText;
    if (assistantText !== undefined) patch.lastAssistantText = assistantText;
    if (intent !== undefined) patch.lastIntent = intent;
    if (topic !== undefined) patch.currentTopic = topic;
    if (lastObject !== undefined) patch.lastObject = lastObject;
    return patchWorldState({ conversation: patch }, 'conversation');
  }

  classifyInput(input = {}) {
    const text = String(input.text || '').trim();
    const reflex = detectReflex(text);
    if (reflex) return reflex;
    return {
      mode: input.deep ? 'deep' : 'realtime',
      intent: input.intent || null,
      input: input.payload || { text },
      confidence: input.intent ? 1 : 0
    };
  }

  async handleInput(input = {}, context = {}) {
    const classified = this.classifyInput(input);
    const trace = createTrace(context);
    events.emitEvent('intent.detected', { ...classified, ...trace });

    if (classified.mode === 'reflex' && getCapability(classified.intent)) {
      const result = await observedAction(classified.intent, trace, () =>
        executeCapability(classified.intent, classified.input, { ...context, trace })
      );
      patchWorldState({
        conversation: { lastIntent: classified.intent, lastUserText: input.text || null },
        computer: { lastAction: classified.intent }
      }, 'orchestrator.reflex');
      return { mode: 'reflex', intent: classified.intent, result, trace };
    }

    return { ...classified, trace, delegated: true };
  }

  createMission(input) { return createMission(input); }

  routeMission(missionId) {
    const full = getMission(missionId);
    if (!full) throw sextaError('MISSION_NOT_FOUND', 'Missão não encontrada.');

    const world = getWorldState();
    const devices = Object.values(world.devices);
    const requiredCapability = full.requiredCapability || inferRequiredCapability(full.context?.toolName || '');

    if (!requiredCapability) return updateMission(missionId, { status: 'running' });

    const device = chooseDevice(devices, requiredCapability, full.sourceDeviceId);
    if (!device) return updateMission(missionId, { status: 'waiting_for_device', assignedDeviceId: null });

    return updateMission(missionId, { status: 'running', assignedDeviceId: device.id, requiredCapability });
  }

  snapshot() { return getWorldState(); }
}

export const orchestrator = new SextaOrchestrator();

events.on('mission.updated', event => {
  if (event.payload?.status === 'completed') {
    patchWorldState({ conversation: { currentTopic: event.payload?.goal || null } }, 'mission.completed');
  }
});
