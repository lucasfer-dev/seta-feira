import crypto from 'node:crypto';
import { events } from './event-bus.mjs';
import { patchWorldState, getWorldState } from './world-state.mjs';

const missions = new Map();
const VALID = new Set(['queued', 'waiting_for_device', 'running', 'completed', 'failed', 'cancelled']);

function snapshot(mission) {
  return structuredClone(mission);
}

function syncMission(mission) {
  patchWorldState({ missions: { [mission.id]: {
    id: mission.id,
    goal: mission.goal,
    status: mission.status,
    updatedAt: mission.updatedAt
  }}}, 'missions');
}

export function createMission({ goal, sourceDeviceId = null, context = {}, requiredCapability = null }) {
  if (!goal || !String(goal).trim()) throw new Error('MISSION_GOAL_REQUIRED');
  const now = new Date().toISOString();
  const mission = {
    id: crypto.randomUUID(),
    goal: String(goal).trim(),
    status: 'queued',
    sourceDeviceId,
    assignedDeviceId: null,
    requiredCapability,
    context,
    steps: [],
    createdAt: now,
    updatedAt: now,
    result: null,
    error: null
  };
  missions.set(mission.id, mission);
  syncMission(mission);
  events.emitEvent('mission.created', snapshot(mission));
  return snapshot(mission);
}

export function listMissions({ status } = {}) {
  return [...missions.values()]
    .filter(m => !status || m.status === status)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(snapshot);
}

export function getMission(id) {
  const mission = missions.get(id);
  return mission ? snapshot(mission) : null;
}

export function hydrateMission(mission) {
  if (!mission?.id) throw new Error('MISSION_ID_REQUIRED');
  const normalized = {
    ...mission,
    steps: Array.isArray(mission.steps) ? mission.steps : [],
    context: mission.context && typeof mission.context === 'object' ? mission.context : {},
    createdAt: mission.createdAt || new Date().toISOString(),
    updatedAt: mission.updatedAt || mission.createdAt || new Date().toISOString()
  };
  missions.set(normalized.id, normalized);
  syncMission(normalized);
  return snapshot(normalized);
}

export function updateMission(id, patch = {}) {
  const mission = missions.get(id);
  if (!mission) throw new Error('MISSION_NOT_FOUND');
  if (patch.status && !VALID.has(patch.status)) throw new Error('MISSION_STATUS_INVALID');
  Object.assign(mission, patch, { updatedAt: new Date().toISOString() });
  syncMission(mission);
  events.emitEvent('mission.updated', snapshot(mission));
  return snapshot(mission);
}

export function addMissionStep(id, step) {
  const mission = missions.get(id);
  if (!mission) throw new Error('MISSION_NOT_FOUND');
  mission.steps.push({
    id: crypto.randomUUID(),
    title: String(step?.title || 'Etapa'),
    status: step?.status || 'pending',
    detail: step?.detail || null,
    createdAt: new Date().toISOString()
  });
  mission.updatedAt = new Date().toISOString();
  syncMission(mission);
  events.emitEvent('mission.step_added', { missionId: id, step: mission.steps.at(-1) });
  return snapshot(mission);
}

export function cancelMission(id) {
  return updateMission(id, { status: 'cancelled' });
}

export function restoreMissionsFromWorldState() {
  const world = getWorldState();
  return world.missions || {};
}
