import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const TOKEN_FILE = path.join(root, '.sexta-google-token.enc');
const TIMEZONE = process.env.SEXTA_TIMEZONE || 'America/Sao_Paulo';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://mail.google.com/',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/tasks'
];

function googleConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/api/google/callback`
  };
}

function cryptoKey() {
  return crypto.createHash('sha256').update(config().secret || 'sexta-local').digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cryptoKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('SXT1'), iv, tag, data]).toString('base64');
}

function decryptJson(raw) {
  const buf = Buffer.from(raw, 'base64');
  if (buf.subarray(0, 4).toString() !== 'SXT1') throw new Error('GOOGLE_TOKEN_FORMAT');
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', cryptoKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, encryptJson(token), { mode: 0o600 });
}

function loadToken() {
  try { return decryptJson(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}

export function googleStatus() {
  const g = googleConfig();
  const token = loadToken();
  return {
    configured: Boolean(g.clientId && g.clientSecret),
    connected: Boolean(token?.refresh_token || (token?.access_token && token?.expires_at > Date.now())),
    redirectUri: g.redirectUri,
    scopes: GOOGLE_SCOPES,
    tokenStore: 'encrypted-local-file'
  };
}

function stateSignature(nonce) {
  return crypto.createHmac('sha256', config().secret).update(nonce).digest('base64url');
}

export function createGoogleAuthUrl() {
  const g = googleConfig();
  if (!g.clientId || !g.clientSecret) throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');
  const nonce = `${Date.now()}.${crypto.randomBytes(12).toString('hex')}`;
  const state = `${nonce}.${stateSignature(nonce)}`;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', g.clientId);
  u.searchParams.set('redirect_uri', g.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

function verifyState(state) {
  const [timestamp, noncePart, sig] = String(state || '').split('.');
  if (!timestamp || !noncePart || !sig) return false;
  const nonce = `${timestamp}.${noncePart}`;
  if (Date.now() - Number(timestamp) > 10 * 60 * 1000) return false;
  const expected = stateSignature(nonce);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

export async function exchangeGoogleCode(code, state) {
  if (!verifyState(state)) throw new Error('GOOGLE_OAUTH_BAD_STATE');
  const g = googleConfig();
  const body = new URLSearchParams({
    code, client_id: g.clientId, client_secret: g.clientSecret,
    redirect_uri: g.redirectUri, grant_type: 'authorization_code'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`GOOGLE_OAUTH_${r.status}: ${JSON.stringify(data).slice(0, 500)}`);
  const previous = loadToken() || {};
  saveToken({ ...previous, ...data, expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000) - 60_000 });
  return googleStatus();
}

async function accessToken() {
  let token = loadToken();
  if (!token) throw new Error('GOOGLE_NOT_CONNECTED');
  if (token.access_token && token.expires_at > Date.now()) return token.access_token;
  if (!token.refresh_token) throw new Error('GOOGLE_RECONNECT_REQUIRED');
  const g = googleConfig();
  const body = new URLSearchParams({
    client_id: g.clientId, client_secret: g.clientSecret,
    refresh_token: token.refresh_token, grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
    signal: AbortSignal.timeout(15000)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`GOOGLE_REFRESH_${r.status}: ${JSON.stringify(data).slice(0, 500)}`);
  token = { ...token, ...data, expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000) - 60_000 };
  saveToken(token);
  return token.access_token;
}

async function googleFetch(url, { method = 'GET', body, headers = {} } = {}) {
  const token = await accessToken();
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(`GOOGLE_API_${r.status}: ${typeof data === 'string' ? data.slice(0,500) : JSON.stringify(data).slice(0,500)}`);
  return data;
}

function dateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(date);
  const obj = Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10);
}

function rangeFor(day) {
  const base = dateParts();
  const iso = day === 'tomorrow' ? addDaysIso(base, 1) : base;
  return {
    start: `${iso}T00:00:00-03:00`,
    end: `${addDaysIso(iso, 1)}T00:00:00-03:00`,
    iso
  };
}

export async function calendarList(day = 'today') {
  const { start, end, iso } = rangeFor(day);
  const u = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  u.searchParams.set('timeMin', start); u.searchParams.set('timeMax', end);
  u.searchParams.set('singleEvents','true'); u.searchParams.set('orderBy','startTime'); u.searchParams.set('maxResults','20');
  const data = await googleFetch(u.toString());
  return { date: iso, events: (data.items || []).map(e => ({ id:e.id, summary:e.summary || '(sem título)', start:e.start, end:e.end, htmlLink:e.htmlLink })) };
}

export async function calendarCreate({ title, date, startDateTime, endDateTime, description = '', reminders = [] }) {
  const event = { summary: title, description };
  if (startDateTime) {
    event.start = { dateTime: startDateTime, timeZone: TIMEZONE };
    event.end = { dateTime: endDateTime || new Date(new Date(startDateTime).getTime()+60*60*1000).toISOString(), timeZone: TIMEZONE };
  } else {
    event.start = { date };
    event.end = { date: addDaysIso(date,1) };
  }
  if (reminders.length) event.reminders = { useDefault:false, overrides: reminders.slice(0,5).map(minutes => ({ method:'popup', minutes:Number(minutes) })) };
  return googleFetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method:'POST', body:event });
}

export async function gmailUnread(maxResults = 5) {
  const u = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  u.searchParams.set('q','is:unread newer_than:14d'); u.searchParams.set('maxResults', String(Math.min(10,maxResults)));
  const list = await googleFetch(u.toString());
  const result = [];
  for (const item of (list.messages || []).slice(0,maxResults)) {
    const m = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const headers = Object.fromEntries((m.payload?.headers || []).map(h=>[h.name.toLowerCase(),h.value]));
    result.push({ id:m.id, threadId:m.threadId, from:headers.from || '', subject:headers.subject || '(sem assunto)', date:headers.date || '', snippet:m.snippet || '', labelIds:m.labelIds || [] });
  }
  return result;
}

function b64url(text) { return Buffer.from(text,'utf8').toString('base64url'); }
export async function gmailSend({ to, subject, body }) {
  const raw = [`To: ${to}`, `Subject: ${subject || '(sem assunto)'}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', '', body || ''].join('\r\n');
  return googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method:'POST', body:{ raw:b64url(raw) } });
}

export async function gmailSendSmart({ recipient, subject = 'Mensagem', body = '' }) {
  let to = String(recipient || '').trim();
  if (!to.includes('@')) {
    const matches = await contactsSearch(to, 5);
    const withEmail = matches.find(x => x.emails?.length);
    if (!withEmail) throw new Error('GOOGLE_CONTACT_EMAIL_NOT_FOUND');
    to = withEmail.emails[0];
  }
  const result = await gmailSend({ to, subject, body });
  return { ...result, to, subject };
}

export async function driveSearch(query, maxResults = 8) {
  const safe = String(query || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', `trashed = false and (name contains '${safe}' or fullText contains '${safe}')`);
  u.searchParams.set('pageSize', String(Math.min(20,maxResults)));
  u.searchParams.set('orderBy','modifiedTime desc');
  u.searchParams.set('fields','files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName,emailAddress))');
  return (await googleFetch(u.toString())).files || [];
}

export async function contactsSearch(query, maxResults = 8) {
  const u = new URL('https://people.googleapis.com/v1/people/me/connections');
  u.searchParams.set('personFields','names,emailAddresses,phoneNumbers'); u.searchParams.set('pageSize','1000');
  const people = (await googleFetch(u.toString())).connections || [];
  const q = String(query||'').toLocaleLowerCase('pt-BR');
  return people.map(p => ({
    resourceName:p.resourceName,
    name:p.names?.[0]?.displayName || '',
    emails:(p.emailAddresses||[]).map(x=>x.value),
    phones:(p.phoneNumbers||[]).map(x=>x.value)
  })).filter(p => `${p.name} ${p.emails.join(' ')} ${p.phones.join(' ')}`.toLocaleLowerCase('pt-BR').includes(q)).slice(0,maxResults);
}

export async function docsCreate({ title, text = '' }) {
  const doc = await googleFetch('https://docs.googleapis.com/v1/documents', { method:'POST', body:{ title } });
  if (text) {
    await googleFetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, { method:'POST', body:{ requests:[{ insertText:{ location:{ index:1 }, text } }] } });
  }
  return doc;
}

export async function sheetsCreate({ title }) {
  return googleFetch('https://sheets.googleapis.com/v4/spreadsheets', { method:'POST', body:{ properties:{ title } } });
}

export async function taskCreate({ title, notes = '', due = '' }) {
  const lists = await googleFetch('https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=10');
  const listId = lists.items?.[0]?.id;
  if (!listId) throw new Error('GOOGLE_TASKLIST_MISSING');
  const body = { title, notes };
  if (due) body.due = new Date(`${due}T12:00:00Z`).toISOString();
  return googleFetch(`https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`, { method:'POST', body });
}

export async function executeWorkspaceAction(action, args = {}) {
  switch (action) {
    case 'calendar.list': return calendarList(args.day || 'today');
    case 'calendar.create': return calendarCreate(args);
    case 'gmail.unread': return gmailUnread(args.maxResults || 5);
    case 'gmail.send': return gmailSend(args);
    case 'gmail.send-smart': return gmailSendSmart(args);
    case 'drive.search': return driveSearch(args.query || '', args.maxResults || 8);
    case 'contacts.search': return contactsSearch(args.query || '', args.maxResults || 8);
    case 'docs.create': return docsCreate(args);
    case 'sheets.create': return sheetsCreate(args);
    case 'tasks.create': return taskCreate(args);
    default: throw new Error('GOOGLE_ACTION_NOT_ALLOWED');
  }
}

const MONTHS = { janeiro:1, fevereiro:2, marco:3, março:3, abril:4, maio:5, junho:6, julho:7, agosto:8, setembro:9, outubro:10, novembro:11, dezembro:12 };
function parsePtDate(text) {
  const t = String(text).toLowerCase();
  if (t.includes('amanhã') || t.includes('amanha')) return addDaysIso(dateParts(),1);
  if (t.includes('hoje')) return dateParts();
  const m = t.match(/\b(?:dia\s+)?(\d{1,2})\s+de\s+([a-zçãáéíóú]+)(?:\s+de\s+(\d{4}))?/i);
  if (!m) return '';
  const month = MONTHS[m[2].normalize('NFC')]; if (!month) return '';
  let year = Number(m[3] || new Intl.DateTimeFormat('en',{timeZone:TIMEZONE,year:'numeric'}).format(new Date()));
  const iso = `${year}-${String(month).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
  if (!m[3] && iso < dateParts()) year++;
  return `${year}-${String(month).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
}

export function detectWorkspaceIntent(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();
  const mentionsCalendar = /(agenda|calend[aá]rio|compromissos?|eventos?)/i.test(t);
  const asksSchedule = /(o que|quais|qual|tenho|tem|mostra|diz)/i.test(t);
  if (mentionsCalendar && asksSchedule && (t.includes('amanhã') || t.includes('amanha'))) return { action:'calendar.list', args:{day:'tomorrow'} };
  if (mentionsCalendar && asksSchedule && t.includes('hoje')) return { action:'calendar.list', args:{day:'today'} };
  if (/\b(adiciona|adicione|coloca|coloque|marca|marque|agenda|agende|cria|crie)\b.*\b(agenda|calend[aá]rio|evento|anivers[aá]rio)\b/.test(t) || /\bna minha agenda\b/.test(t)) {
    const date = parsePtDate(raw);
    if (date) {
      let title = raw
        .replace(/^(sexta(?:[- ]feira)?[, ]*)?/i,'')
        .replace(/\b(adiciona|adicione|coloca|coloque|marca|marque|agenda|agende|cria|crie)\b/i,'')
        .replace(/\b(na|minha|no|calend[aá]rio|agenda|evento)\b/gi,'')
        .replace(/\b(?:dia\s+)?\d{1,2}\s+de\s+[a-zçãáéíóú]+(?:\s+de\s+\d{4})?/i,'')
        .replace(/\s+/g,' ').trim().replace(/^[:,-]+|[:,-]+$/g,'').trim();
      if (!title) title = 'Evento';
      return { action:'calendar.create', args:{ title, date } };
    }
  }
  if (/(e-?mails?|gmail)/i.test(t) && /(não lido|nao lido|não lidos|nao lidos|novos?|importantes?|recebi|chegou|chegaram|ver|ler)/i.test(t)) return { action:'gmail.unread', args:{maxResults:5} };
  const sendMail = raw.match(/(?:manda|mande|envia|envie)\s+(?:um\s+)?(?:e-?mail)\s+(?:para|pro)\s+(.+?)\s+(?:dizendo|falando|com a mensagem)\s+(.+)/i);
  if (sendMail?.[1] && sendMail?.[2]) return { action:'gmail.send-smart', args:{recipient:sendMail[1].trim(),subject:'Mensagem da Sexta-feira',body:sendMail[2].trim()} };
  const drive = raw.match(/(?:procura|procure|busca|busque|acha|ache).*(?:no|na)\s+(?:meu\s+)?drive[: ]+(.+)/i);
  if (drive?.[1]) return { action:'drive.search', args:{query:drive[1].trim()} };
  const contact = raw.match(/(?:contato|telefone|email|e-mail).*(?:do|da|de)\s+(.+)/i);
  if (contact?.[1]) return { action:'contacts.search', args:{query:contact[1].trim()} };
  const doc = raw.match(/(?:cria|crie)\s+(?:um\s+)?(?:documento|doc)(?:\s+(?:chamado|com o nome|de nome))?\s+(.+)/i);
  if (doc?.[1]) return { action:'docs.create', args:{title:doc[1].trim()} };
  const sheet = raw.match(/(?:cria|crie)\s+(?:uma\s+)?(?:planilha|sheet)(?:\s+(?:chamada|com o nome|de nome))?\s+(.+)/i);
  if (sheet?.[1]) return { action:'sheets.create', args:{title:sheet[1].trim()} };
  const task = raw.match(/(?:cria|crie|adiciona|adicione)\s+(?:uma\s+)?tarefa(?:\s+para)?\s+(.+)/i);
  if (task?.[1]) { const due=parsePtDate(raw)||''; const title=task[1].replace(/hoje/gi,'').replace(/amanhã/gi,'').replace(/amanha/gi,'').replace(/\s+/g,' ').trim(); return { action:'tasks.create', args:{title:title||task[1].trim(), due} }; }
  return null;
}

export function formatWorkspaceResult(intent, result) {
  switch (intent.action) {
    case 'calendar.create': return `Feito. Coloquei “${result.summary || intent.args.title}” na sua agenda para ${intent.args.date.split('-').reverse().join('/')}.`;
    case 'calendar.list': {
      if (!result.events?.length) return `Você não tem eventos na agenda em ${result.date.split('-').reverse().join('/')}.`;
      return `Na agenda: ${result.events.slice(0,5).map(e=>e.summary).join('; ')}.`;
    }
    case 'gmail.unread': return result.length ? `Você tem ${result.length} e-mails não lidos recentes. ${result.slice(0,3).map(m=>`${m.subject}, de ${m.from}`).join('; ')}.` : 'Não encontrei e-mails não lidos recentes.';
    case 'gmail.send-smart': return `E-mail enviado para ${result.to}.`;
    case 'gmail.send': return `E-mail enviado para ${result.to || intent.args.to}.`;
    case 'drive.search': return result.length ? `Encontrei ${result.length} item(ns) no Drive. Os primeiros são: ${result.slice(0,5).map(f=>f.name).join(', ')}.` : 'Não encontrei nada no Drive com esse termo.';
    case 'contacts.search': return result.length ? `${result[0].name}: ${[...result[0].emails,...result[0].phones].filter(Boolean).join(', ') || 'sem e-mail ou telefone disponível'}.` : 'Não encontrei esse contato.';
    case 'docs.create': return `Documento criado: ${result.title || intent.args.title}.`;
    case 'sheets.create': return `Planilha criada: ${result.properties?.title || intent.args.title}.`;
    case 'tasks.create': return `Tarefa criada: ${result.title || intent.args.title}.`;
    default: return 'Ação do Google concluída.';
  }
}
