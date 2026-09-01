import { getDevices, getEvents, getMemories, getMessages, getNotifications, getSettings, isOwner, send } from '../lib/core.mjs';

const SHARED_CONVERSATION_ID = 'main';
const CACHE_MS = Math.max(3000, Math.min(30000, Number(process.env.SEXTA_SYNC_CACHE_MS || 12000)));
let cache = null;
let cacheAt = 0;
let inFlight = null;

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
    const now = Date.now();

    if (!forceFresh && cache && now - cacheAt < CACHE_MS) {
      res.setHeader('X-SEXTA-Sync-Cache', 'HIT');
      return send(res, 200, cache);
    }

    if (!inFlight) {
      inFlight = loadSnapshot()
        .then(snapshot => {
          cache = snapshot;
          cacheAt = Date.now();
          return snapshot;
        })
        .finally(() => { inFlight = null; });
    }

    const snapshot = await inFlight;
    res.setHeader('X-SEXTA-Sync-Cache', forceFresh ? 'BYPASS' : 'MISS');
    return send(res, 200, snapshot);
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: 'sync_failed', message: error.message });
  }
}
