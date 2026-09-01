import { getDevices, getEvents, getMemories, getMessages, getNotifications, getSettings, isOwner, send } from '../lib/core.mjs';
import { getSyncCache, getSyncInFlight, loadSyncCache } from '../lib/sync-cache.mjs';

const SHARED_CONVERSATION_ID = 'main';

async function loadSnapshot() {
  const [messages, memories, devices, events, notifications, settings] = await Promise.all([
    getMessages(SHARED_CONVERSATION_ID, 50),
    getMemories(30),
    getDevices(),
    getEvents(12),
    getNotifications(25),
    getSettings()
  ]);
  return {
    conversationId: SHARED_CONVERSATION_ID,
    messages,
    memories,
    devices,
    events,
    notifications,
    settings,
    generatedAt: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  try {
    const url = new URL(req.url, 'http://localhost');
    const forceFresh = url.searchParams.get('fresh') === '1';
    const cached = forceFresh ? null : getSyncCache();
    if (cached) {
      res.setHeader('X-SEXTA-Sync-Cache', 'HIT');
      return send(res, 200, cached);
    }

    const wasInFlight = Boolean(getSyncInFlight());
    const snapshot = await loadSyncCache(loadSnapshot);
    res.setHeader('X-SEXTA-Sync-Cache', forceFresh ? 'BYPASS' : 'MISS');
    if (wasInFlight) res.setHeader('X-SEXTA-Sync-Coalesced', '1');
    return send(res, 200, snapshot);
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: 'sync_failed', message: error.message });
  }
}
