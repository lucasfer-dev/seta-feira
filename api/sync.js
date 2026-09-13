import { getDevices, getEvents, getMemories, getMessages, getNotifications, getSettings, isOwner, send } from '../lib/core.mjs';
import { buildPersonalityContract } from '../public/sexta-personality.js';
const SHARED_CONVERSATION_ID = 'main';
const CACHE_MS = Math.max(3000, Math.min(30000, Number(process.env.SEXTA_SYNC_CACHE_MS || 12000)));
const VOICE_CACHE_MS = Math.max(CACHE_MS, Math.min(60000, Number(process.env.SEXTA_VOICE_CONTEXT_CACHE_MS || 30000)));
const caches = new Map();
const inFlights = new Map();
function memoryVisible(item = {}, { deviceId = '' } = {}) {
  const expires = Date.parse(String(item.expiresAt || item.expires_at || ''));
  if (Number.isFinite(expires) && expires <= Date.now()) return false;
  const scope = String(item.scope || 'global').toLowerCase();
  if (scope === 'device' && deviceId && String(item.deviceId || item.device_id || '') !== deviceId) return false;
  return true;
}
function loadersFor(scope) {
  if (scope === 'voice') return { messages:() => getMessages(SHARED_CONVERSATION_ID,18), memories:() => getMemories(16), settings:() => getSettings() };
  return { messages:() => getMessages(SHARED_CONVERSATION_ID,50), memories:() => getMemories(30), devices:() => getDevices(), events:() => getEvents(12), notifications:() => getNotifications(25), settings:() => getSettings() };
}
async function loadSnapshot(scope = 'full', deviceId = '') {
  const loaders = loadersFor(scope); const names = Object.keys(loaders);
  const settled = await Promise.allSettled(names.map(name => loaders[name]()));
  const previous = caches.get(scope)?.value || {}; const result = {}; const errors = {};
  names.forEach((name,index) => { const row = settled[index]; if (row.status === 'fulfilled') result[name] = row.value; else { errors[name] = String(row.reason?.message || row.reason || 'unknown_error').slice(0,500); result[name] = previous[name] !== undefined ? previous[name] : name === 'settings' ? {} : []; } });
  if (Array.isArray(result.memories)) result.memories = result.memories.filter(item => memoryVisible(item,{deviceId}));
  return { conversationId:SHARED_CONVERSATION_ID, scope, ...result, personalityInstruction:buildPersonalityContract(result.settings || {},{channel:'voice-live',platform:'connected-device'}), generatedAt:new Date().toISOString(), degraded:Object.keys(errors).length>0, errors };
}
function refresh(scope, deviceId) {
  if (inFlights.has(scope)) return inFlights.get(scope);
  const promise = loadSnapshot(scope,deviceId).then(value => { caches.set(scope,{value,at:Date.now()}); return value; }).finally(() => inFlights.delete(scope));
  inFlights.set(scope,promise); return promise;
}
export default async function handler(req,res) {
  if (req.method !== 'GET') return send(res,405,{error:'method_not_allowed'});
  if (!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try {
    const url = new URL(req.url,'http://localhost'); const scope = url.searchParams.get('scope') === 'voice' ? 'voice' : 'full';
    const deviceId = String(url.searchParams.get('deviceId') || '').slice(0,120); const forceFresh = url.searchParams.get('fresh') === '1';
    const ttl = scope === 'voice' ? VOICE_CACHE_MS : CACHE_MS; const cached = caches.get(scope); const age = cached ? Date.now()-cached.at : Infinity;
    if (!forceFresh && cached && age < ttl) { res.setHeader('X-SEXTA-Sync-Cache','HIT'); return send(res,200,cached.value); }
    if (!forceFresh && cached) { void refresh(scope,deviceId).catch(error => console.warn('[SEXTA Sync] background refresh:',String(error?.message||error).slice(0,240))); res.setHeader('X-SEXTA-Sync-Cache','STALE-WHILE-REVALIDATE'); return send(res,200,{...cached.value,refreshing:true,cacheAgeMs:age}); }
    const snapshot = await refresh(scope,deviceId); res.setHeader('X-SEXTA-Sync-Cache',forceFresh?'BYPASS':'MISS'); return send(res,200,snapshot);
  } catch (error) {
    console.error('[SEXTA Sync]',error); const stale = caches.get('full')?.value || caches.get('voice')?.value;
    if (stale) { res.setHeader('X-SEXTA-Sync-Cache','STALE'); return send(res,200,{...stale,degraded:true,stale:true,syncError:String(error?.message||error).slice(0,500)}); }
    return send(res,500,{error:'sync_failed',message:String(error?.message||error)});
  }
}
