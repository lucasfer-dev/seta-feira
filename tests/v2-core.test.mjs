import test from 'node:test';
import assert from 'node:assert/strict';

import { resetWorldState, getWorldState, updateDeviceState } from '../lib/v2/world-state.mjs';
import { createMission, getMission } from '../lib/v2/missions.mjs';
import { orchestrator } from '../lib/v2/orchestrator.mjs';
import { chooseDevice, normalizeCapabilities } from '../lib/v2/device-capabilities.mjs';

test('desktop receives home-hub capabilities', () => {
  const caps = normalizeCapabilities('desktop');
  assert.ok(caps.includes('coding'));
  assert.ok(caps.includes('obsidian'));
  assert.ok(caps.includes('windows'));
});

test('device selection respects required capability', () => {
  const devices = [
    { id: 'phone', kind: 'android', online: true },
    { id: 'pc', kind: 'desktop', online: true }
  ];
  assert.equal(chooseDevice(devices, 'coding')?.id, 'pc');
  assert.equal(chooseDevice(devices, 'camera')?.id, 'phone');
});

test('mission waits when required device is offline and routes when it appears', () => {
  resetWorldState();
  const mission = createMission({ goal: 'Revisar projeto', requiredCapability: 'coding' });

  let routed = orchestrator.routeMission(mission.id);
  assert.equal(routed.status, 'waiting_for_device');

  updateDeviceState('pc', { kind: 'desktop', online: true });
  routed = orchestrator.routeMission(mission.id);

  assert.equal(routed.status, 'running');
  assert.equal(routed.assignedDeviceId, 'pc');
  assert.equal(getMission(mission.id)?.status, 'running');
});

test('world state tracks conversation and devices independently', () => {
  resetWorldState();
  orchestrator.recordConversation({ userText: 'Sexta', intent: 'wake' });
  orchestrator.registerDevice({ id: 'phone', kind: 'android', online: true });
  const state = getWorldState();

  assert.equal(state.conversation.lastIntent, 'wake');
  assert.equal(state.devices.phone.kind, 'android');
});
