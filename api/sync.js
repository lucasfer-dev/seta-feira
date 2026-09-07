import { getDevices, getEvents, getMemories, getMessages, getNotifications, getSettings, isOwner, send } from '../lib/core.mjs';
import { buildPersonalityContract } from '../public/sexta-personality.js';

const SHARED_CONVERSATION_ID = 'main';
const CACHE_MS = Math.max(3000, Math.min(30000, Number(process.env.SEXTA_SYNC_CACHE_MS || 12000)));
let cache = null;
let cacheAt = 0;
let inFlight = null;

const loaders = {
  messages: () => getMessages(SHARED_CONVERSATION_ID, 50),
  memories: () => getMemories(30),
  devices: () => getDevices(),
  events: () => getEvents(12),
  notifications: () => getNotifications(25),
  settings: () => getSettings()
};

async function loadSnapshot() {
  const names = Object.keys(loaders);
  const settled = await Promise.allSettled(names.map(name => loaders[name]()));
  const previous = cache || {};
  const result = {};
  const errors = {};

  names.forEach((name, index) => {
    const row = settled[index];
    if (row.status === 'fulfilled') result[name] = row.value;
    else {
      errors[name] = String(row.reason?.message || row.reason || 'unknown_error').slice(0, 500);
      if (previous[name] !== undefined) result[name] = previous[name];
      else result[name] = name === 'settings' ? {} : [];
    }
  });

  return {
    conversationId: SHARED_CONVERSATION_ID,
    ...result,
    personalityInstruction: buildPersonalityContract(result.settings || {}, { channel:'voice-live', platform:'connected-device' }),
    generatedAt: new Date().toISOString(),
    degraded: Object.keys(errors).length > 0,
    errors
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
    console.error('[SEXTA Sync]', error);
    if (cache) {
      res.setHeader('X-SEXTA-Sync-Cache', 'STALE');
      return send(res, 200, { ...cache, degraded: true, stale: true, syncError: String(error?.message || error).slice(0, 500) });
    }
    return send(res, 500, { error: 'sync_failed', message: String(error?.message || error) });
  }
}
