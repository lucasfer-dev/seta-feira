import crypto from 'node:crypto';
import { buildPersonalityContract, normalizePersonality } from '../public/sexta-personality.js';

const OWNER = 'owner';
const memoryState = {
  messages: [], memories: [], vaultNotes: [], devices: new Map(), commands: [], events: [], notifications: [], pushTokens: [], settings: {}
};

// Temporary model circuit breaker: when a Gemini model is overloaded, skip it for a few minutes.
const geminiCooldowns = new Map();
const GEMINI_COOLDOWN_MS = 5 * 60 * 1000;

export function config() {
  return {
    pin: process.env.SEXTA_ACCESS_PIN || '',
    secret: process.env.SEXTA_SERVER_SECRET || 'local-development-secret',
    agentToken: process.env.SEXTA_AGENT_TOKEN || 'local-agent-token',
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
    geminiFallbackModels: process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.6-flash,gemini-3.5-flash,gemini-3.5-flash-lite',
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    supabaseKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '',
    supabaseApiKey: process.env.SEXTA_DATA_API_KEY || ''
  };
}

export function modeInfo() {
  const c = config();
  return {
    cloud: Boolean(c.supabaseUrl && c.supabaseKey && c.supabaseApiKey),
    ai: c.geminiKey ? 'gemini' : 'demo',
    model: c.geminiKey ? c.geminiModel : 'sexta-demo-brain',
    authRequired: Boolean(c.pin) || Boolean(c.supabaseUrl && c.supabaseKey),
    secureConfig: Boolean(c.pin && process.env.SEXTA_SERVER_SECRET && (!c.supabaseUrl || (process.env.SEXTA_AGENT_TOKEN && c.supabaseApiKey)))
  };
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function createOwnerToken() {
  const c = config();
  const payload = b64url(JSON.stringify({ sub: OWNER, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  const sig = crypto.createHmac('sha256', c.secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyOwnerToken(token) {
  if (!token) return false;
  const c = config();
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', c.secret).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.sub === OWNER && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function bearer(req) {
  const value = req.headers?.authorization || req.headers?.Authorization || '';
  return String(value).startsWith('Bearer ') ? String(value).slice(7) : '';
}

export function isOwner(req) {
  const c = config();
  if (!c.pin && !modeInfo().cloud && bearer(req) === 'demo-owner') return true;
  return verifyOwnerToken(bearer(req));
}

export function isAgent(req) {
  const token = bearer(req);
  const c = config();
  if (modeInfo().cloud && !process.env.SEXTA_AGENT_TOKEN) return false;
  return Boolean(token && token === c.agentToken);
}

export async function parseJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}'); } catch { return {}; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function sb(path, { method = 'GET', query, body, prefer } = {}) {
  const c = config();
  if (!c.supabaseUrl || !c.supabaseKey) throw new Error('SUPABASE_NOT_CONFIGURED');
  const url = new URL(`${c.supabaseUrl}/rest/v1/${path}`);
  if (query) Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const headers = {
    apikey: c.supabaseKey,
    Authorization: `Bearer ${c.supabaseKey}`,
    'x-sexta-api-key': c.supabaseApiKey,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SUPABASE_${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function saveMessage(row) {
  const data = { owner_id: OWNER, ...row };
  if (modeInfo().cloud) {
    await sb('sexta_messages', { method: 'POST', body: data, prefer: 'return=minimal' });
  } else {
    memoryState.messages.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...data });
    memoryState.messages = memoryState.messages.slice(-200);
  }
}

export async function getMessages(conversationId, limit = 30) {
  if (modeInfo().cloud) {
    const rows = await sb('sexta_messages', { query: {
      select: 'id,conversation_id,role,content,device_id,created_at',
      conversation_id: `eq.${conversationId}`,
      order: 'created_at.desc',
      limit: String(limit)
    }});
    return (rows || []).reverse();
  }
  return memoryState.messages.filter(m => m.conversation_id === conversationId).slice(-limit);
}

export async function saveMemory({ content, kind = 'fact', importance = 0.65, source = 'conversation' }) {
  if (!content || content.trim().length < 5) return null;
  const now = new Date().toISOString();
  const data = { owner_id: OWNER, content: content.trim().slice(0, 1000), kind, importance, source, updated_at: now };
  let saved;
  if (modeInfo().cloud) {
    const rows = await sb('sexta_memories', { method: 'POST', body: data, prefer: 'return=representation' });
    saved = rows?.[0] || { id: crypto.randomUUID(), created_at: now, ...data };
  } else {
    saved = { id: crypto.randomUUID(), created_at: now, ...data };
    memoryState.memories.unshift(saved);
    memoryState.memories = memoryState.memories.slice(0, 80);
  }
  try { await syncMemoryToVault(saved); } catch (error) { console.warn('[SEXTA Vault] memória salva, mas o espelho Markdown falhou:', error.message); }
  return saved;
}

export async function getMemories(limit = 16) {
  if (modeInfo().cloud) {
    return await sb('sexta_memories', { query: {
      select: 'id,kind,content,importance,source,created_at,updated_at',
      order: 'importance.desc,updated_at.desc',
      limit: String(limit)
    }}) || [];
  }
  return memoryState.memories.slice(0, limit);
}

export async function deleteMemory(id) {
  if (!id) return;
  if (modeInfo().cloud) {
    await sb('sexta_vault_notes', { method: 'DELETE', query: { source_memory_id: `eq.${id}` }, prefer: 'return=minimal' });
    await sb('sexta_memories', { method: 'DELETE', query: { id: `eq.${id}` }, prefer: 'return=minimal' });
  } else {
    memoryState.memories = memoryState.memories.filter(x => x.id !== id);
    memoryState.vaultNotes = memoryState.vaultNotes.filter(x => x.source_memory_id !== id);
  }
}

function vaultSlug(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-')
    .replace(/-+/g, '-').toLowerCase().slice(0, 62) || 'memoria';
}

function vaultTitle(content = '') {
  const clean = String(content).replace(/\s+/g, ' ').trim();
  return clean.length > 72 ? `${clean.slice(0, 69).trim()}…` : clean || 'Memória';
}

function vaultFolder(memory = {}) {
  const text = String(memory.content || '').toLowerCase();
  if (memory.kind === 'event' || /anivers[aá]rio|agenda|evento|reuni[aã]o/.test(text)) return 'eventos';
  if (memory.kind === 'preference' || /prefiro|gosto|n[aã]o gosto|prefer/.test(text)) return 'preferencias';
  if (/namorada|namorado|m[aã]e|pai|irm[aã]o|irm[aã]|amigo|amiga|coordenador|coordenadora/.test(text)) return 'pessoas';
  if (/projeto|envista|sexta|app|site|sistema|startup/.test(text)) return 'projetos';
  if (/ideia|pensei|talvez|poderia/.test(text)) return 'ideias';
  if (/decidi|decis[aã]o|vamos usar|n[aã]o vamos/.test(text)) return 'decisoes';
  return 'memorias';
}

function vaultMarkdownForMemory(memory) {
  const title = vaultTitle(memory.content);
  const tags = ['sexta', 'memoria', String(memory.kind || 'fact').replace(/[^a-zA-Z0-9_-]/g, '')].filter(Boolean);
  const created = memory.created_at || new Date().toISOString();
  const updated = memory.updated_at || created;
  return `---\nsexta_id: ${memory.id}\ntype: ${memory.kind || 'fact'}\nimportance: ${Number(memory.importance ?? 0.65).toFixed(2)}\nsource: ${String(memory.source || 'conversation').replace(/\n/g, ' ')}\ncreated: ${created}\nupdated: ${updated}\ntags:\n${tags.map(t => `  - ${t}`).join('\n')}\n---\n\n# ${title}\n\n${String(memory.content || '').trim()}\n\n## Conexões\n\n- [[00 - Início]]\n`;
}

function vaultHash(markdown = '') {
  return crypto.createHash('sha256').update(String(markdown)).digest('hex');
}

export async function saveVaultNote({ path, title, markdown, kind = 'memory', tags = [], links = [], sourceMemoryId = null, clientUpdatedAt = null, force = false }) {
  const safePath = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '').slice(0, 400);
  if (!safePath || !safePath.toLowerCase().endsWith('.md')) throw new Error('VAULT_PATH_INVALID');
  const bodyText = String(markdown || '').slice(0, 250000);
  const now = new Date().toISOString();
  const hash = vaultHash(bodyText);
  let existing = null;
  if (modeInfo().cloud) {
    const rows = await sb('sexta_vault_notes', { query: { select: 'id,path,title,markdown,kind,tags,links,source_memory_id,content_hash,version,created_at,updated_at', path: `eq.${safePath}`, limit: '1' } });
    existing = rows?.[0] || null;
    if (existing?.content_hash === hash) return { ...existing, unchanged: true };
    if (!force && clientUpdatedAt && existing && new Date(existing.updated_at).getTime() > new Date(clientUpdatedAt).getTime() + 1500) {
      return { ...existing, conflict: true };
    }
    const row = {
      owner_id: OWNER, path: safePath, title: String(title || vaultTitle(bodyText)).slice(0, 180), markdown: bodyText,
      kind: String(kind || 'memory').slice(0, 50), tags: Array.isArray(tags) ? tags.slice(0, 30) : [], links: Array.isArray(links) ? links.slice(0, 60) : [],
      source_memory_id: sourceMemoryId || existing?.source_memory_id || null, content_hash: hash,
      version: Number(existing?.version || 0) + 1, updated_at: now
    };
    const result = await sb('sexta_vault_notes', { method: 'POST', query: { on_conflict: 'owner_id,path' }, body: row, prefer: 'resolution=merge-duplicates,return=representation' });
    return result?.[0] || row;
  }
  existing = memoryState.vaultNotes.find(n => n.path === safePath) || null;
  if (existing?.content_hash === hash) return { ...existing, unchanged: true };
  if (!force && clientUpdatedAt && existing && new Date(existing.updated_at).getTime() > new Date(clientUpdatedAt).getTime() + 1500) return { ...existing, conflict: true };
  const row = {
    id: existing?.id || crypto.randomUUID(), owner_id: OWNER, path: safePath, title: String(title || vaultTitle(bodyText)).slice(0, 180), markdown: bodyText,
    kind, tags, links, source_memory_id: sourceMemoryId || existing?.source_memory_id || null, content_hash: hash,
    version: Number(existing?.version || 0) + 1, created_at: existing?.created_at || now, updated_at: now
  };
  memoryState.vaultNotes = [row, ...memoryState.vaultNotes.filter(n => n.path !== safePath)].slice(0, 500);
  return row;
}

export async function getVaultNotes({ limit = 200, since = '' } = {}) {
  if (modeInfo().cloud) {
    const query = {
      select: 'id,path,title,markdown,kind,tags,links,source_memory_id,content_hash,version,created_at,updated_at',
      order: 'updated_at.desc', limit: String(Math.max(1, Math.min(500, limit)))
    };
    if (since) query.updated_at = `gt.${since}`;
    return await sb('sexta_vault_notes', { query }) || [];
  }
  return memoryState.vaultNotes
    .filter(n => !since || new Date(n.updated_at) > new Date(since))
    .sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, limit);
}

export async function deleteVaultNote(path) {
  const safePath = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(\/|$)/g, '');
  if (!safePath) return false;
  if (modeInfo().cloud) {
    await sb('sexta_vault_notes', { method: 'DELETE', query: { path: `eq.${safePath}` }, prefer: 'return=minimal' });
    return true;
  }
  const before = memoryState.vaultNotes.length;
  memoryState.vaultNotes = memoryState.vaultNotes.filter(n => n.path !== safePath);
  return before !== memoryState.vaultNotes.length;
}

export async function syncMemoryToVault(memory) {
  if (!memory?.id || !memory?.content) return null;
  const folder = vaultFolder(memory);
  const shortId = String(memory.id).slice(0, 8);
  const title = vaultTitle(memory.content);
  const path = `${folder}/${vaultSlug(title)}-${shortId}.md`;
  return saveVaultNote({
    path, title, markdown: vaultMarkdownForMemory(memory), kind: memory.kind || 'memory',
    tags: ['sexta','memoria', memory.kind || 'fact'], links: ['00 - Início'], sourceMemoryId: memory.id,
    clientUpdatedAt: memory.updated_at || memory.created_at, force: true
  });
}

export async function ensureVaultSeed() {
  const seed = [
    {
      path: '00 - Início.md', title: 'SEXTA — Memória', kind: 'index', tags: ['sexta','index'],
      markdown: `---\ntype: index\ntags:\n  - sexta\n  - index\n---\n\n# SEXTA — Memória\n\nEste Vault é a memória de longo prazo da Sexta. Ele é sincronizado entre seus dispositivos e pode ser aberto normalmente no Obsidian.\n\n## Áreas\n\n- [[pessoas/Índice de Pessoas]]\n- [[projetos/Índice de Projetos]]\n- [[preferencias/Preferências]]\n- [[eventos/Eventos]]\n- [[ideias/Ideias]]\n- [[decisoes/Decisões]]\n- [[memorias/Memórias]]\n\n> Você pode editar as notas. Na próxima sincronização, a Sexta lê as alterações de volta.\n`
    },
    ['pessoas/Índice de Pessoas.md','Índice de Pessoas'], ['projetos/Índice de Projetos.md','Índice de Projetos'],
    ['preferencias/Preferências.md','Preferências'], ['eventos/Eventos.md','Eventos'], ['ideias/Ideias.md','Ideias'],
    ['decisoes/Decisões.md','Decisões'], ['memorias/Memórias.md','Memórias']
  ];
  for (const item of seed) {
    if (Array.isArray(item)) {
      const [path, title] = item;
      await saveVaultNote({ path, title, kind:'index', tags:['sexta','index'], markdown:`---\ntype: index\ntags:\n  - sexta\n  - index\n---\n\n# ${title}\n\nVoltar para [[00 - Início]].\n` });
    } else await saveVaultNote(item);
  }
}

function vaultTokens(text = '') {
  return [...new Set(String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]{3,}/g) || [])];
}

export async function findRelevantVaultNotes(message, limit = 4) {
  const notes = await getVaultNotes({ limit: 100 });
  const tokens = vaultTokens(message).filter(t => !['para','com','que','uma','isso','essa','esse','como','qual','quando','onde','porque','sobre'].includes(t));
  const scored = notes.map(note => {
    const hay = `${note.title} ${note.path} ${note.markdown}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const score = tokens.reduce((n,t) => n + (hay.includes(t) ? (note.title.toLowerCase().includes(t) ? 4 : 1) : 0), 0);
    return { note, score };
  }).filter(x => x.score > 0).sort((a,b) => b.score - a.score || String(b.note.updated_at).localeCompare(String(a.note.updated_at)));
  return scored.slice(0, limit).map(x => x.note);
}

export async function heartbeat(device) {
  const now = new Date().toISOString();
  const row = {
    device_id: device.deviceId,
    owner_id: OWNER,
    name: String(device.name || 'Dispositivo').slice(0, 80),
    kind: ['phone','desktop','tablet','browser','agent'].includes(device.kind) ? device.kind : 'browser',
    capabilities: Array.isArray(device.capabilities) ? device.capabilities : [],
    context: device.context && typeof device.context === 'object' ? device.context : {},
    last_seen: now
  };
  if (modeInfo().cloud) {
    await sb('sexta_devices', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal' });
  } else {
    memoryState.devices.set(row.device_id, { created_at: memoryState.devices.get(row.device_id)?.created_at || now, ...row });
  }
  return row;
}

export async function getDevices() {
  let rows;
  if (modeInfo().cloud) {
    rows = await sb('sexta_devices', { query: {
      select: 'device_id,name,kind,capabilities,context,last_seen,created_at',
      order: 'last_seen.desc', limit: '30'
    }}) || [];
  } else {
    rows = [...memoryState.devices.values()].sort((a,b) => String(b.last_seen).localeCompare(String(a.last_seen)));
  }
  const now = Date.now();
  return rows.map(d => ({ ...d, online: now - new Date(d.last_seen).getTime() < 45000 }));
}

export async function queueCommand(targetDeviceId, action, payload = {}) {
  const allowed = new Set(['open_url','open_app','open_project','git_status','get_system_info','read_clipboard','copy_text']);
  if (!allowed.has(action)) throw new Error('ACTION_NOT_ALLOWED');
  const row = {
    id: crypto.randomUUID(), owner_id: OWNER, target_device_id: targetDeviceId,
    action, payload, status: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  };
  if (modeInfo().cloud) {
    const result = await sb('sexta_commands', { method: 'POST', body: { ...row, id: undefined }, prefer: 'return=representation' });
    return result?.[0] || row;
  }
  memoryState.commands.push(row);
  return row;
}

export async function pollCommands(deviceId) {
  if (modeInfo().cloud) {
    return await sb('sexta_commands', { query: {
      select: 'id,target_device_id,action,payload,status,created_at',
      target_device_id: `eq.${deviceId}`, status: 'eq.queued', order: 'created_at.asc', limit: '5'
    }}) || [];
  }
  return memoryState.commands.filter(c => c.target_device_id === deviceId && c.status === 'queued').slice(0, 5);
}

export async function updateCommand(id, status, result) {
  const patch = { status, result: result || null, updated_at: new Date().toISOString() };
  if (modeInfo().cloud) {
    await sb('sexta_commands', { method: 'PATCH', query: { id: `eq.${id}` }, body: patch, prefer: 'return=minimal' });
  } else {
    const item = memoryState.commands.find(c => c.id === id);
    if (item) Object.assign(item, patch);
  }
}

export async function getCommand(id) {
  if (modeInfo().cloud) {
    const rows = await sb('sexta_commands', { query: { select:'id,status,result,action,target_device_id,updated_at', id:`eq.${id}`, limit:'1' } });
    return rows?.[0] || null;
  }
  return memoryState.commands.find(c => c.id === id) || null;
}

export async function addEvent({ sourceDeviceId, level = 'info', title, body = '', metadata = {} }) {
  const row = {
    id: crypto.randomUUID(), owner_id: OWNER, source_device_id: sourceDeviceId || null,
    level, title: String(title || 'Evento').slice(0, 140), body: String(body || '').slice(0, 1500), metadata,
    created_at: new Date().toISOString()
  };
  if (modeInfo().cloud) {
    const { id, ...insert } = row;
    await sb('sexta_events', { method: 'POST', body: insert, prefer: 'return=minimal' });
  } else {
    memoryState.events.unshift(row);
    memoryState.events = memoryState.events.slice(0, 80);
  }
  return row;
}

export async function getEvents(limit = 12) {
  if (modeInfo().cloud) {
    return await sb('sexta_events', { query: {
      select: 'id,source_device_id,level,title,body,metadata,created_at', order: 'created_at.desc', limit: String(limit)
    }}) || [];
  }
  return memoryState.events.slice(0, limit);
}

export async function saveNotification({ source, sourceId = null, sender = '', title, body = '', priority = 0, reason = '', metadata = {} }) {
  const data = {
    owner_id: OWNER, source: String(source || 'unknown').slice(0,40), source_id: sourceId ? String(sourceId).slice(0,180) : null,
    sender: String(sender || '').slice(0,220), title: String(title || 'Notificação').slice(0,220), body: String(body || '').slice(0,2200),
    priority: Math.max(0, Math.min(100, Number(priority || 0))), reason: String(reason || '').slice(0,500), status: 'unread',
    metadata: metadata && typeof metadata === 'object' ? metadata : {}, created_at: new Date().toISOString()
  };
  if (modeInfo().cloud) {
    if (data.source_id) {
      const existing = await sb('sexta_notifications', { query: { select:'id,source,source_id,sender,title,body,priority,reason,status,metadata,created_at', source:`eq.${data.source}`, source_id:`eq.${data.source_id}`, limit:'1' } });
      if (existing?.[0]) return { ...existing[0], created:false };
    }
    const rows = await sb('sexta_notifications', { method:'POST', body:data, prefer:'return=representation' });
    return { ...(rows?.[0] || data), created:true };
  }
  if (data.source_id) {
    const existing = memoryState.notifications.find(n => n.source === data.source && n.source_id === data.source_id);
    if (existing) return { ...existing, created:false };
  }
  const row = { id:crypto.randomUUID(), ...data };
  memoryState.notifications.unshift(row);
  memoryState.notifications = memoryState.notifications.slice(0,200);
  return { ...row, created:true };
}

export async function getNotifications(limit = 30, status = '') {
  if (modeInfo().cloud) {
    const query = { select:'id,source,source_id,sender,title,body,priority,reason,status,metadata,created_at', order:'created_at.desc', limit:String(limit) };
    if (status) query.status = `eq.${status}`;
    return await sb('sexta_notifications', { query }) || [];
  }
  const rows = status ? memoryState.notifications.filter(n => n.status === status) : memoryState.notifications;
  return rows.slice(0,limit);
}

export async function updateNotification(id, patch = {}) {
  const safe = {};
  if (['unread','read','dismissed','acted'].includes(patch.status)) safe.status = patch.status;
  if (modeInfo().cloud) {
    await sb('sexta_notifications', { method:'PATCH', query:{id:`eq.${id}`}, body:safe, prefer:'return=minimal' });
    return true;
  }
  const row=memoryState.notifications.find(n=>n.id===id);
  if (row) Object.assign(row,safe);
  return Boolean(row);
}

export async function registerPushToken({ deviceId, provider='fcm', token, platform='android' }) {
  if (!token) throw new Error('PUSH_TOKEN_REQUIRED');
  const row = { owner_id:OWNER, device_id:String(deviceId||'unknown').slice(0,120), provider:String(provider).slice(0,20), token:String(token).slice(0,1000), platform:String(platform).slice(0,30), enabled:true, updated_at:new Date().toISOString() };
  if (modeInfo().cloud) {
    await sb('sexta_push_tokens', { method:'POST', body:row, prefer:'resolution=merge-duplicates,return=minimal' });
  } else {
    const idx=memoryState.pushTokens.findIndex(x=>x.provider===row.provider && x.token===row.token);
    if (idx>=0) memoryState.pushTokens[idx]={...memoryState.pushTokens[idx],...row}; else memoryState.pushTokens.push({id:crypto.randomUUID(),created_at:new Date().toISOString(),...row});
  }
  return { ok:true };
}

export async function getPushTokens() {
  if (modeInfo().cloud) return await sb('sexta_push_tokens', { query:{select:'device_id,provider,token,platform,enabled,created_at,updated_at',enabled:'eq.true',limit:'50'} }) || [];
  return memoryState.pushTokens.filter(x=>x.enabled);
}

export async function getSettings() {
  if (modeInfo().cloud) {
    const rows = await sb('sexta_settings', { query: { select: 'settings', owner_id: 'eq.owner', limit: '1' } });
    return sanitizeSettings(rows?.[0]?.settings || {});
  }
  return sanitizeSettings(memoryState.settings || {});
}

export async function saveSettings(settings) {
  const safe = sanitizeSettings(settings);
  if (modeInfo().cloud) {
    await sb('sexta_settings', { method: 'POST', body: { owner_id: OWNER, settings: safe, updated_at: new Date().toISOString() }, prefer: 'resolution=merge-duplicates,return=minimal' });
  } else {
    memoryState.settings = safe;
  }
  return safe;
}

export function sanitizeSettings(input = {}) {
  const personality = normalizePersonality(input);
  return {
    ...personality,
    voice: input.voice !== false, autoSpeak: input.autoSpeak !== false,
    speakNotifications: input.speakNotifications !== false,
    notificationThreshold: Math.max(0, Math.min(100, Number.isFinite(Number(input.notificationThreshold)) ? Number(input.notificationThreshold) : 62)),
    whatsappNotifyAll: input.whatsappNotifyAll !== false,
    name: String(input.name || 'Sexta-feira').slice(0, 30)
  };
}

export function maybeExtractMemory(text) {
  const clean = String(text || '').trim();
  const patterns = [
    /^(?:sexta[, ]+)?(?:lembra|lembre|guarda|guarde|anota|anote)(?: aí| disso| que)?[: ]+(.{5,})$/i,
    /^(?:eu )?prefiro\s+(.{5,})$/i,
    /^(?:eu )?(?:gosto muito|não gosto)\s+(.{5,})$/i
  ];
  for (const p of patterns) {
    const m = clean.match(p);
    if (m?.[1]) return { content: m[1].trim(), kind: 'preference', importance: 0.82, source: 'explicit' };
  }
  return null;
}

export async function inferAndQueueSafeAction(text) {
  const t = String(text || '').toLowerCase().trim();
  const devices = await getDevices();
  const target = devices.find(d => d.online && ['agent','desktop'].includes(d.kind));
  if (!target) return null;

  let action = null; let payload = {};
  if (/\b(abre|abrir)\b.*\b(vscode|vs code|visual studio code)\b/.test(t)) {
    action = 'open_app'; payload = { app: 'vscode' };
  } else if (/\b(abre|abrir)\b.*\b(spotify)\b/.test(t)) {
    action = 'open_app'; payload = { app: 'spotify' };
  } else if (/\b(abre|abrir)\b.*\b(navegador|browser|chrome)\b/.test(t)) {
    action = 'open_app'; payload = { app: 'browser' };
  } else if (/\b(status|situa[cç][aã]o)\b.*\bgit\b|\bgit\b.*\b(status|situa[cç][aã]o)\b/.test(t)) {
    action = 'git_status';
  } else {
    const project = t.match(/\b(?:abre|abrir)\b.*\bprojeto\s+([\w.-]{2,50})/i);
    if (project) { action = 'open_project'; payload = { project: project[1] }; }
  }
  if (!action) return null;
  const command = await queueCommand(target.device_id, action, payload);
  return { commandId: command.id, target: target.name, action, payload };
}

function personalityPrompt(settings) {
  return buildPersonalityContract(settings, { channel:'chat', platform:'cloud-core' }) +
    '\nPara ações no computador, confie apenas no bloco AÇÃO DO SISTEMA. Se houver uma ação enfileirada, informe isso de forma natural.\n' +
    'Proteja privacidade: nunca peça senhas, tokens, cookies ou chaves privadas.';
}

function isComplexRequest(message) {
  const t = String(message || '').toLowerCase();
  if (t.length > 420) return true;
  return /\b(analisa|analise|arquitetura|debug|depura|c[oó]digo|programa[cç][aã]o|estrat[eé]gia|planeja|planejamento|compare|compara|pesquisa|investiga|raciocina|explique detalhadamente|passo a passo|refatora|refatore|sql|typescript|javascript|java|python|react|next\.js|supabase|erro|stack trace)\b/i.test(t);
}

function routedGeminiModels(c, message) {
  const normal = geminiModelChain(c);
  if (isComplexRequest(message)) return normal;
  // Routine voice/chat should prioritize the low-latency free-tier model.
  const fast = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.5-flash', c.geminiModel];
  return [...new Set([...fast, ...normal])];
}

function fastServerAnswer(message) {
  const t = String(message || '').toLowerCase().trim();
  const now = new Date();
  const tz = process.env.SEXTA_TIMEZONE || 'America/Sao_Paulo';
  if (/\b(que horas|qual a hora|horas s[aã]o|hora agora)\b/.test(t)) return `Agora são ${now.toLocaleTimeString('pt-BR',{timeZone:tz,hour:'2-digit',minute:'2-digit'})}.`;
  if (/\b(que dia|qual a data|data de hoje|dia [ée] hoje)\b/.test(t)) return `Hoje é ${now.toLocaleDateString('pt-BR',{timeZone:tz,weekday:'long',day:'2-digit',month:'long',year:'numeric'})}.`;
  if (/^(oi|ol[aá]|e a[ií]|fala|sexta(?:[- ]feira)?)[!?., ]*$/.test(t)) return 'Estou aqui. Manda.';
  return '';
}

function geminiModelChain(c) {
  const fallbacks = String(c.geminiFallbackModels || '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
  return [...new Set([c.geminiModel, ...fallbacks])];
}

function geminiText(data) {
  const sdkText = typeof data?.output_text === 'string' ? data.output_text : '';
  const stepText = Array.isArray(data?.steps)
    ? data.steps
        .filter(step => step?.type === 'model_output' && Array.isArray(step.content))
        .flatMap(step => step.content)
        .filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n')
    : '';
  return String(sdkText || stepText).trim();
}

function transientGeminiFailure(status, body = '') {
  if (!status) return true; // DNS/network/timeout: try another model before giving up.
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  return /high demand|overloaded|temporar|unavailable|resource_exhausted|rate.?limit|fetch failed|timeout/i.test(body);
}

function modelOnCooldown(model) {
  const until = geminiCooldowns.get(model) || 0;
  if (until <= Date.now()) {
    geminiCooldowns.delete(model);
    return false;
  }
  return true;
}

function cooldownModel(model, status, body = '') {
  if ([429, 500, 502, 503, 504].includes(status) || /high demand|overloaded|resource_exhausted/i.test(body)) {
    geminiCooldowns.set(model, Date.now() + GEMINI_COOLDOWN_MS);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function askGeminiModel({ key, model, input, system }) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      model,
      input,
      system_instruction: system,
      store: false,
      generation_config: { thinking_level: 'low' }
    }),
    signal: AbortSignal.timeout(12000)
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`GEMINI_${response.status}: ${body.slice(0, 500)}`);
    error.status = response.status;
    error.responseBody = body;
    throw error;
  }

  const data = await response.json();
  const text = geminiText(data);
  if (!text) throw Object.assign(new Error('GEMINI_EMPTY_RESPONSE'), { status: 502, responseBody: 'empty response' });
  return text;
}

async function askGeminiWithFallback({ c, input, system, models = geminiModelChain(c) }) {
  const failures = [];

  for (const model of models) {
    if (modelOnCooldown(model)) {
      console.warn(`[SEXTA] ${model} em cooldown; pulando para o próximo cérebro.`);
      continue;
    }

    // High-demand responses should fail over immediately instead of making the user wait.
    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const text = await askGeminiModel({ key: c.geminiKey, model, input, system });
        geminiCooldowns.delete(model);
        if (model !== c.geminiModel) console.warn(`[SEXTA] Gemini fallback ativo: ${model}`);
        return text;
      } catch (error) {
        const status = Number(error?.status || 0);
        const body = String(error?.responseBody || error?.message || '');
        const transient = transientGeminiFailure(status, body);
        failures.push({ model, status, message: String(error?.message || '').slice(0, 180) });
        console.warn(`[SEXTA] ${model} falhou (${status || 'network'}), tentativa ${attempt}/${maxAttempts}`);

        if (!transient) {
          // Bad auth/request errors are global and won't improve by switching models.
          if ([400, 401, 403].includes(status)) throw error;
          break;
        }

        // A transport/DNS failure affects every model on the same API endpoint.
        // Retry the current model once, then fail fast instead of wasting ~30s cycling models.
        if (!status) {
          if (attempt < maxAttempts) { await sleep(250); continue; }
          const networkError = new Error('GEMINI_NETWORK: não consegui alcançar a API do Gemini. Verifique a internet e tente novamente.');
          networkError.status = 503;
          throw networkError;
        }

        cooldownModel(model, status, body);

        // Server overload/quota: immediately move to the next model.
        if ([429, 500, 502, 503, 504].includes(status) || /high demand|overloaded|resource_exhausted/i.test(body)) break;

        if (attempt === maxAttempts) break;
        await sleep(250 * attempt);
      }
    }
  }

  const summary = failures.map(f => `${f.model}:${f.status || 'network'}`).join(', ');
  const error = new Error(`GEMINI_UNAVAILABLE: todos os cérebros estão temporariamente indisponíveis (${summary || 'cooldown'})`);
  error.status = 503;
  throw error;
}

export async function answer({ message, conversationId, deviceId, settings, clientContext = {}, actionContext = null }) {
  const immediate = fastServerAnswer(message);
  if (immediate && !actionContext) return immediate;

  const complex = isComplexRequest(message);
  const history = await getMessages(conversationId, complex ? 14 : 7);
  const memories = await getMemories(complex ? 10 : 5);
  const vaultNotes = await findRelevantVaultNotes(message, complex ? 5 : 3);
  const memoryText = memories.length ? memories.map(m => `- ${m.content}`).join('\n') : '- Nenhuma memória permanente ainda.';
  const vaultText = vaultNotes.length
    ? vaultNotes.map(n => `- [${n.path}] ${String(n.markdown || '').replace(/^---[\s\S]*?---/m,'').replace(/\s+/g,' ').trim().slice(0,700)}`).join('\n')
    : '- Nenhuma nota relevante no Vault.';
  const transcript = history.map(m => `${m.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${m.content}`).join('\n');
  const actionText = actionContext ? JSON.stringify(actionContext) : 'nenhuma';
  const tz = process.env.SEXTA_TIMEZONE || 'America/Sao_Paulo';
  const nowText = new Intl.DateTimeFormat('pt-BR',{timeZone:tz,weekday:'long',year:'numeric',month:'long',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date());
  const system = personalityPrompt(settings) + `\nData/hora real do sistema: ${nowText} (${tz}). Nunca invente dia da semana ou horário; use este valor.`;
  const deviceContext = complex ? JSON.stringify(clientContext).slice(0, 3000) : JSON.stringify({ device: clientContext?.device, localTime: clientContext?.localTime, voiceRequest: clientContext?.voiceRequest });
  const input = `MEMÓRIAS RELEVANTES:\n${memoryText}\n\nVAULT OBSIDIAN RELEVANTE:\n${vaultText}\n\nCONTEXTO DO DISPOSITIVO:\n${deviceContext}\n\nAÇÃO DO SISTEMA:\n${actionText}\n\nCONVERSA RECENTE:\n${transcript || '(início da conversa)'}\n\nUSUÁRIO: ${message}\n\nResponda como Sexta. Trate o Vault Obsidian como memória de longo prazo editável pelo usuário.`;

  const c = config();
  if (!c.geminiKey) return demoAnswer(message, actionContext, memories, settings);
  const models = routedGeminiModels(c, message);
  return askGeminiWithFallback({ c, input, system, models });
}

function demoAnswer(message, actionContext, memories, settings) {
  const t = String(message).toLowerCase();
  const s = sanitizeSettings(settings);
  if (actionContext) {
    const names = { open_app: 'abrir o aplicativo', open_project: 'abrir o projeto', git_status: 'verificar o Git' };
    return `A ordem de ${names[actionContext.action] || 'executar a ação'} foi enviada para ${actionContext.target}. ${s.sarcasm > 65 ? 'Agora falta o computador fazer a parte dele.' : ''}`.trim();
  }
  if (/^(oi|ol[aá]|e a[ií]|sexta\??)$/i.test(String(message).trim())) return 'Estou aqui. O que você precisa?';
  if (t.includes('quem é você') || t.includes('o que você é')) return 'Sou a Sexta-feira: sua assistente no celular, no PC e no navegador. No momento estou usando o cérebro de demonstração.';
  if (t.includes('lembra') && memories.length) return `Lembro. A informação mais relevante agora é: “${memories[0].content}”.`;
  if (t.includes('hora')) return `Agora são ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`;
  if (t.includes('teste')) return 'Teste recebido. Interface, memória, dispositivos e voz estão de pé. Para respostas realmente inteligentes, conecte a chave gratuita do Gemini.';
  return 'Entendi. Estou no modo de demonstração agora; consigo cuidar da interface, memória explícita e dispositivos, mas a conversa completa entra quando você conectar o cérebro Gemini.';
}
