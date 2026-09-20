import { events } from './event-bus.mjs';
import { updateDeviceState } from './world-state.mjs';

const HUB_ID = 'home-hub';

export function setHomeHubOnline({ deviceId = HUB_ID, name = 'SEXTA Home Hub', capabilities = [] } = {}) {
  const device = updateDeviceState(deviceId, {
    name,
    kind: 'desktop',
    online: true,
    active: true,
    capabilities: [...new Set(['filesystem', 'coding', 'browser_automation', 'windows', 'obsidian', 'screen', ...capabilities])],
    lastSeenAt: new Date().toISOString()
  });
  events.emitEvent('home_hub.online', { device });
  return device;
}

export function setHomeHubOffline(deviceId = HUB_ID) {
  const device = updateDeviceState(deviceId, {
    online: false,
    lastSeenAt: new Date().toISOString()
  });
  events.emitEvent('home_hub.offline', { deviceId });
  return device;
}

export function queueVaultSync(payload = {}) {
  return events.emitEvent('vault.sync_requested', {
    source: payload.source || 'cloud',
    reason: payload.reason || 'memory_changed',
    memoryId: payload.memoryId || null,
    requestedAt: new Date().toISOString()
  });
}
