import crypto from 'node:crypto';
import { addEvent, deleteVaultNote, getDevices, getNotifications, getVaultNotes, saveNotification, saveVaultNote } from './core.mjs';

export const EVENT_ENGINE_VERSION = '1.0.0';
const TYPES = new Set(['device_online', 'device_offline', 'memory_above', 'disk_free_below', 'gmail_sender', 'gmail_subject', 'schedule_daily']);

function slug(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || crypto.randomUUID();
}
function parseNote(note) {
  if (note?.kind !== 'event-rule') return null;
  const match = String(note.markdown || '').match(/```sexta-event-rule\s*([\s\S]*?)```/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
function markdownFor(rule) {
  return `# ${rule.name}\n\nRegra proativa da SEXTA.\n\n\`\`\`sexta-event-rule\n${JSON.stringify(rule, null, 2)}\n\`\`\`\n`;
}
function conditionObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > 8000) throw new Error('EVENT_RULE_CONDITION_TOO_LARGE');
  return JSON.parse(json);
}
function validate(rule) {
  if (!TYPES.has(rule.type)) throw new Error('EVENT_RULE_TYPE_INVALID');
  if (['memory_above', 'disk_free_below'].includes(rule.type)) {
    const percent = Number(rule.condition.percent);
    if (!(percent > 0 && percent <= 100)) throw new Error('EVENT_RULE_PERCENT_INVALID');
    rule.condition.percent = percent;
  }
  if (['gmail_sender', 'gmail_subject'].includes(rule.type) && !String(rule.condition.contains || '').trim()) throw new Error('EVENT_RULE_TEXT_REQUIRED');
  if (rule.type === 'schedule_daily') {
    const time = String(rule.condition.time || '08:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('EVENT_RULE_TIME_INVALID');
    rule.condition.time = time;
    rule.condition.timezone = String(rule.condition.timezone || 'America/Sao_Paulo').slice(0, 80);
  }
  return rule;
}
async function persistRule(rule) {
  await saveVaultNote({ path: `event-rules/${rule.id}.md`, title: rule.name, markdown: markdownFor(rule), kind: 'event-rule', tags: ['sexta', 'event-engine'], links: [], force: true });
  return rule;
}

export async function listEventRules() {
  const notes = await getVaultNotes({ limit: 500 });
  return notes.map(parseNote).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
export async function getEventRule(idOrName = '') {
  const key = String(idOrName || '').trim().toLowerCase();
  return (await listEventRules()).find(item => item.id === key || String(item.name || '').toLowerCase() === key || slug(item.name) === slug(key)) || null;
}
export async function saveEventRule(input = {}) {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (name.length < 2) throw new Error('EVENT_RULE_NAME_REQUIRED');
  const existing = input.id ? await getEventRule(input.id) : await getEventRule(name);
  const now = new Date().toISOString();
  const rule = validate({
    version: EVENT_ENGINE_VERSION,
    id: String(existing?.id || input.id || slug(name)).toLowerCase().slice(0, 80),
    name,
    type: String(input.type || existing?.type || '').trim(),
    condition: conditionObject(input.condition ?? existing?.condition ?? {}),
    title: String(input.title ?? existing?.title ?? name).replace(/\s+/g, ' ').trim().slice(0, 140),
    body: String(input.body ?? existing?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000),
    enabled: input.enabled !== false,
    lastCondition: Boolean(existing?.lastCondition),
    lastTriggeredKey: String(existing?.lastTriggeredKey || ''),
    lastTriggeredAt: String(existing?.lastTriggeredAt || ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  });
  return persistRule(rule);
}
export async function deleteEventRule(idOrName = '') {
  const rule = await getEventRule(idOrName);
  if (!rule) return false;
  await deleteVaultNote(`event-rules/${rule.id}.md`);
  return true;
}

function targetDevice(rule, devices) {
  const id = String(rule.condition.deviceId || '').trim();
  const name = String(rule.condition.deviceName || '').trim().toLowerCase();
  if (id) return devices.find(device => device.device_id === id) || null;
  if (name) return devices.find(device => String(device.name || '').toLowerCase().includes(name)) || null;
  return devices.find(device => ['agent', 'desktop'].includes(String(device.kind || '').toLowerCase())) || devices[0] || null;
}
function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}
function evaluate(rule, { devices, notifications, now }) {
  if (rule.type === 'device_online' || rule.type === 'device_offline') {
    const device = targetDevice(rule, devices);
    const online = Boolean(device?.online);
    const condition = rule.type === 'device_online' ? online : !online;
    return { condition, key: condition ? `${rule.type}:${device?.device_id || 'missing'}` : '', details: { device: device?.name || null, online } };
  }
  if (rule.type === 'memory_above') {
    const device = targetDevice(rule, devices);
    const value = Number(device?.context?.hardware?.memory?.usedPercent);
    const condition = Number.isFinite(value) && value >= Number(rule.condition.percent);
    return { condition, key: condition ? `memory:${device?.device_id}:${Math.round(value)}` : '', details: { value, threshold: rule.condition.percent, device: device?.name || null } };
  }
  if (rule.type === 'disk_free_below') {
    const device = targetDevice(rule, devices);
    const disks = Array.isArray(device?.context?.hardware?.disks) ? device.context.hardware.disks : [];
    const lowest = disks.filter(d => Number.isFinite(Number(d.freePercent))).sort((a, b) => Number(a.freePercent) - Number(b.freePercent))[0];
    const value = Number(lowest?.freePercent);
    const condition = Number.isFinite(value) && value <= Number(rule.condition.percent);
    return { condition, key: condition ? `disk:${device?.device_id}:${lowest?.name || 'disk'}` : '', details: { value, threshold: rule.condition.percent, disk: lowest?.name || null, device: device?.name || null } };
  }
  if (rule.type === 'gmail_sender' || rule.type === 'gmail_subject') {
    const needle = String(rule.condition.contains || '').toLowerCase();
    const field = rule.type === 'gmail_sender' ? 'sender' : 'title';
    const match = notifications.find(item => item.source === 'gmail' && String(item[field] || '').toLowerCase().includes(needle));
    return { condition: Boolean(match), key: match ? `gmail:${match.source_id || match.sourceId || match.id}` : '', details: match ? { sender: match.sender, title: match.title } : {} };
  }
  if (rule.type === 'schedule_daily') {
    const parts = localParts(now, rule.condition.timezone);
    const [hour, minute] = rule.condition.time.split(':');
    const condition = parts.hour === hour && Number(parts.minute) >= Number(minute);
    return { condition, key: condition ? `daily:${parts.year}-${parts.month}-${parts.day}` : '', details: { localTime: `${parts.hour}:${parts.minute}`, timezone: rule.condition.timezone } };
  }
  return { condition: false, key: '', details: {} };
}

export async function runEventEngine({ now = new Date() } = {}) {
  const [rules, devices, notifications] = await Promise.all([listEventRules(), getDevices(), getNotifications(100)]);
  const triggered = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const result = evaluate(rule, { devices, notifications, now });
    const edgeTriggered = rule.type === 'gmail_sender' || rule.type === 'gmail_subject' || rule.type === 'schedule_daily'
      ? result.condition && result.key && result.key !== rule.lastTriggeredKey
      : result.condition && rule.lastCondition !== true;
    let changed = rule.lastCondition !== result.condition;
    rule.lastCondition = result.condition;
    if (edgeTriggered) {
      rule.lastTriggeredKey = result.key || `${rule.type}:${Date.now()}`;
      rule.lastTriggeredAt = now.toISOString();
      changed = true;
      const notification = await saveNotification({
        source: 'event-engine', sourceId: `${rule.id}:${rule.lastTriggeredKey}`, sender: 'SEXTA Event Engine',
        title: rule.title || rule.name, body: rule.body || `Regra acionada: ${rule.name}`,
        priority: 88, reason: `event-rule:${rule.type}`, metadata: { ruleId: rule.id, ruleType: rule.type, ...result.details }
      });
      await addEvent({ level: 'info', title: `Event Engine • ${rule.name}`, body: rule.body || 'Condição atendida.', metadata: { kind: 'event-engine', ruleId: rule.id, ruleType: rule.type, ...result.details } });
      triggered.push({ rule: rule.id, name: rule.name, notification, details: result.details });
    }
    if (changed) { rule.updatedAt = new Date().toISOString(); await persistRule(rule); }
  }
  return { version: EVENT_ENGINE_VERSION, checked: rules.filter(rule => rule.enabled).length, triggered };
}
