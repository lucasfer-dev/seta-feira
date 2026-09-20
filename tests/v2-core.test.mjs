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


test('mission command result closes the mission and preserves verified result', async () => {
  resetWorldState();
  orchestrator.registerDevice({ id: 'pc-runtime', kind: 'desktop', online: true });
  const mission = createMission({ goal: 'Abrir navegador', requiredCapability: 'windows' });

  const { dispatchMissionCommand, applyCommandResultToMission } = await import('../lib/v2/mission-runtime.mjs');
  const dispatched = await dispatchMissionCommand({
    missionId: mission.id,
    targetDeviceId: 'pc-runtime',
    action: 'open_app',
    payload: { app: 'browser' }
  });

  assert.equal(dispatched.mission.status, 'running');
  assert.ok(dispatched.command.id);

  const completed = await applyCommandResultToMission({
    commandId: dispatched.command.id,
    status: 'done',
    result: { ok: true, verified: true, app: 'browser' }
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.verified, true);
  assert.equal(completed.steps[0].status, 'completed');
});


test('agent device is eligible as Home Hub for coding and Obsidian missions', () => {
  const caps = normalizeCapabilities('agent', ['codex_task']);
  assert.ok(caps.includes('coding'));
  assert.ok(caps.includes('obsidian'));
  assert.ok(caps.includes('windows'));
});
