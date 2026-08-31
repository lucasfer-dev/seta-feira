import crypto from 'node:crypto';
import { contactsSearch, googleStatus } from './google.mjs';

function cfg() {
  return {
    baseUrl: String(process.env.EVOLUTION_BASE_URL || '').replace(/\/$/,''),
    apiKey: process.env.EVOLUTION_API_KEY || '',
    instance: process.env.EVOLUTION_INSTANCE || '',
    webhookSecret: process.env.EVOLUTION_WEBHOOK_SECRET || '',
    publicBaseUrl: String(process.env.SEXTA_PUBLIC_BASE_URL || '').replace(/\/$/,'')
  };
}

export function evolutionStatus() {
  const c = cfg();
  return {
    configured: Boolean(c.baseUrl && c.apiKey && c.instance),
    webhookReady: Boolean(c.webhookSecret && c.publicBaseUrl),
    instance: c.instance || '',
    baseUrl: c.baseUrl ? new URL(c.baseUrl).origin : '',
    webhookUrl: c.publicBaseUrl ? `${c.publicBaseUrl}/api/evolution/webhook` : ''
  };
}

async function evolutionFetch(path, { method='GET', body }={}) {
  const c = cfg();
  if (!c.baseUrl || !c.apiKey || !c.instance) throw new Error('EVOLUTION_NOT_CONFIGURED');
  const r = await fetch(`${c.baseUrl}${path}`, {
    method,
    headers: { apikey:c.apiKey, 'Content-Type':'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw:text }; }
  if (!r.ok) throw new Error(`EVOLUTION_${r.status}: ${JSON.stringify(data).slice(0,700)}`);
  return data;
}

export async function evolutionConnectionState() {
  const c=cfg();
  if (!evolutionStatus().configured) return { configured:false, connected:false };
  const candidates = [
    `/instance/connectionState/${encodeURIComponent(c.instance)}`,
    `/instance/fetchInstances?instanceName=${encodeURIComponent(c.instance)}`
  ];
  for (const path of candidates) {
    try {
      const data=await evolutionFetch(path);
      const state=data?.instance?.state || data?.state || data?.instance?.status || data?.[0]?.connectionStatus || data?.[0]?.state || '';
      return { configured:true, connected:/open|connected/i.test(String(state)), state:String(state||'unknown'), raw:data };
    } catch {}
  }
  return { configured:true, connected:false, state:'unverified' };
}

export async function configureEvolutionWebhook() {
  const c=cfg();
  const status=evolutionStatus();
  if (!status.configured) throw new Error('EVOLUTION_NOT_CONFIGURED');
  if (!status.webhookReady) throw new Error('EVOLUTION_WEBHOOK_URL_NOT_CONFIGURED');
  const payload = {
    enabled:true,
    url:status.webhookUrl,
    webhook_by_events:false,
    webhook_base64:false,
    events:['MESSAGES_UPSERT','MESSAGES_UPDATE','CONNECTION_UPDATE'],
    headers: { 'x-sexta-webhook-secret': c.webhookSecret }
  };
  const paths = [
    `/event/webhook/set/${encodeURIComponent(c.instance)}`,
    `/webhook/set/${encodeURIComponent(c.instance)}`
  ];
  let last;
  for (const path of paths) {
    try { return await evolutionFetch(path,{method:'POST',body:payload}); }
    catch (error) { last=error; }
  }
  throw last || new Error('EVOLUTION_WEBHOOK_CONFIG_FAILED');
}

function cleanPhone(value='') { return String(value).replace(/\D/g,''); }

export async function resolveWhatsAppRecipient(recipient) {
  const raw=String(recipient||'').trim();
  const digits=cleanPhone(raw);
  if (digits.length >= 10) return { number:digits, label:raw };
  if (googleStatus().connected) {
    const matches=await contactsSearch(raw,8);
    const candidates=matches.flatMap(p => (p.phones||[]).map(phone=>({name:p.name,phone,number:cleanPhone(phone)}))).filter(x=>x.number.length>=10);
    if (candidates.length===1) return { number:candidates[0].number, label:candidates[0].name };
    if (candidates.length>1) {
      const error=new Error('WHATSAPP_RECIPIENT_AMBIGUOUS');
      error.candidates=candidates.slice(0,5); throw error;
    }
  }
  throw new Error('WHATSAPP_CONTACT_NOT_FOUND');
}

export async function sendWhatsAppText({ recipient, text }) {
  const c=cfg();
  const to=await resolveWhatsAppRecipient(recipient);
  const payload={ number:to.number, text:String(text||'').slice(0,4000) };
  let result;
  try { result=await evolutionFetch(`/message/sendText/${encodeURIComponent(c.instance)}`,{method:'POST',body:payload}); }
  catch (first) {
    // Older Evolution versions used a nested textMessage shape.
    result=await evolutionFetch(`/message/sendText/${encodeURIComponent(c.instance)}`,{method:'POST',body:{number:to.number,textMessage:{text:payload.text}}});
  }
  return { to, result };
}

export function verifyEvolutionWebhook(req) {
  const c=cfg();
  if (!c.webhookSecret) return false;
  const supplied=String(req.headers?.['x-sexta-webhook-secret'] || '');
  if (!supplied) return false;
  try { return crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(c.webhookSecret)); } catch { return false; }
}

function messageText(message={}) {
  return String(
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    ''
  ).trim();
}

export function parseEvolutionIncoming(payload={}) {
  const event=String(payload.event || payload.type || '').toUpperCase().replace(/[.-]/g,'_');
  if (event && !event.includes('MESSAGES_UPSERT') && !event.includes('MESSAGE')) return null;
  const data=payload.data || payload;
  const key=data.key || data.message?.key || {};
  const msg=data.message?.message || data.message || {};
  const remoteJid=String(key.remoteJid || data.remoteJid || '');
  const fromMe=Boolean(key.fromMe);
  const isGroup=remoteJid.endsWith('@g.us');
  const text=messageText(msg);
  if (!remoteJid || fromMe || !text) return null;
  return {
    sourceId:String(key.id || data.id || crypto.randomUUID()),
    sender:String(data.pushName || data.senderName || remoteJid.replace(/@.+$/,'')),
    remoteJid,
    text,
    fromMe,
    isGroup,
    timestamp:data.messageTimestamp || data.timestamp || Date.now()
  };
}

export function detectWhatsAppIntent(text='') {
  const raw=String(text).trim();
  const m=raw.match(/(?:manda|mande|envia|envie|responde|responda)\s+(?:uma\s+)?(?:mensagem\s+)?(?:no|pelo|por)?\s*(?:whats?app|wpp|zap)?\s*(?:para|pro|pra|ao|à)?\s*([^,:]+?)\s*(?:dizendo|falando|com a mensagem|:|que)\s+(.+)/i);
  if (m?.[1] && m?.[2]) return { action:'whatsapp.send', args:{recipient:m[1].trim(),text:m[2].trim()} };
  return null;
}
