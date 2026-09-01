import crypto from 'node:crypto';
import { config, getCommand, getDevices, modeInfo } from './core.mjs';

const ANDROID_ACTIONS = new Set([
  'open_app','open_url','notification_list','notification_reply',
  'media_play_pause','media_next','media_previous',
  'volume_set','volume_adjust','flashlight','share_text','dial','sms_compose','open_settings','device_info'
]);

function normalize(text = '') {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g,' ').trim();
}

async function supabaseInsertCommand(row) {
  const c = config();
  if (!modeInfo().cloud) throw new Error('ANDROID_ACTIONS_REQUIRE_CLOUD');
  const response = await fetch(`${c.supabaseUrl}/rest/v1/sexta_commands`, {
    method: 'POST',
    headers: {
      apikey: c.supabaseKey,
      Authorization: `Bearer ${c.supabaseKey}`,
      'x-sexta-api-key': c.supabaseApiKey,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) throw new Error(`ANDROID_QUEUE_${response.status}: ${await response.text()}`);
  const rows = await response.json();
  return rows?.[0] || row;
}

export async function queueAndroidAction(action, payload = {}, targetDeviceId = '') {
  if (!ANDROID_ACTIONS.has(action)) throw new Error('ANDROID_ACTION_NOT_ALLOWED');
  let target = targetDeviceId;
  if (!target) {
    const devices = await getDevices();
    target = devices.find(device => device.online && device.kind === 'android')?.device_id || '';
  }
  if (!target) throw new Error('NO_ANDROID_ONLINE');
  const now = new Date().toISOString();
  return supabaseInsertCommand({
    owner_id: 'owner',
    target_device_id: target,
    action,
    payload: payload && typeof payload === 'object' ? payload : {},
    status: 'queued',
    created_at: now,
    updated_at: now
  });
}

function appNameFromText(t) {
  const names = [
    ['whatsapp business','whatsapp business'],['whatsapp','whatsapp'],['spotify','spotify'],['youtube','youtube'],
    ['instagram','instagram'],['telegram','telegram'],['discord','discord'],['gmail','gmail'],['google maps','google maps'],
    ['maps','maps'],['drive','drive'],['google fotos','google fotos'],['fotos','fotos'],['camera','camera'],
    ['calculadora','calculadora'],['calendario','calendario'],['agenda','agenda'],['mensagens','mensagens'],['telefone','telefone']
  ];
  for (const [needle, app] of names) if (t.includes(needle)) return app;
  return '';
}

export function detectAndroidIntent(text = '') {
  const raw = String(text).trim();
  const t = normalize(raw);
  if (!t) return null;

  const mobileExplicit = /\b(celular|android|telefone|no meu celular|nesse celular|neste celular)\b/.test(t);

  // Respostas enviam conteúdo externo e precisam passar pelo Tool Bus,
  // que cria uma confirmação idempotente antes de chegar ao Android.
  if (/\b(?:responde|responder|responda)\b/.test(t)) return null;

  let m;

  if (/\b(?:quem|quais|mostra|le|ler|ve|ver)\b.*\b(?:mensagens?|notificacoes?|notificações?)\b.*\bwhatsapp\b/.test(t) || /\bwhatsapp\b.*\b(?:mensagens?|notificacoes?|notificações?)\b/.test(t)) {
    return { action:'notification_list', payload:{ package:'whatsapp', limit:10 }, reply:'Vou consultar as notificações recentes do WhatsApp.' };
  }

  if (/\b(?:pausa|pause|toca|toque|continuar|continua|play)\b.*\b(?:musica|música|spotify|midia|mídia)?\b/.test(t)) {
    return { action:'media_play_pause', payload:{}, reply:'Certo, vou alternar a reprodução no celular.' };
  }
  if (/\b(?:proxima|próxima|pula|pular)\b.*\b(?:musica|música|faixa)\b/.test(t)) return { action:'media_next', payload:{}, reply:'Vou para a próxima faixa.' };
  if (/\b(?:volta|anterior)\b.*\b(?:musica|música|faixa)\b/.test(t)) return { action:'media_previous', payload:{}, reply:'Vou voltar uma faixa.' };

  m = t.match(/\b(?:volume)\b.*?\b(\d{1,3})\s*%?/);
  if (m) return { action:'volume_set', payload:{ percent:Math.max(0,Math.min(100,Number(m[1]))) }, reply:`Vou ajustar o volume para ${Math.max(0,Math.min(100,Number(m[1])))}%.` };
  if (/\b(?:aumenta|sobe)\b.*\bvolume\b|\bvolume\b.*\b(?:aumenta|sobe)\b/.test(t)) return { action:'volume_adjust', payload:{direction:'up'}, reply:'Vou aumentar o volume.' };
  if (/\b(?:abaixa|diminui|reduz)\b.*\bvolume\b|\bvolume\b.*\b(?:abaixa|diminui|reduz)\b/.test(t)) return { action:'volume_adjust', payload:{direction:'down'}, reply:'Vou diminuir o volume.' };

  if (/\b(?:liga|acende)\b.*\b(?:lanterna|flash)\b/.test(t)) return { action:'flashlight', payload:{enabled:true}, reply:'Vou ligar a lanterna.' };
  if (/\b(?:desliga|apaga)\b.*\b(?:lanterna|flash)\b/.test(t)) return { action:'flashlight', payload:{enabled:false}, reply:'Vou desligar a lanterna.' };

  if (/\b(?:abre|abrir|abra)\b/.test(t)) {
    const app = appNameFromText(t);
    if (app && (mobileExplicit || !['chrome'].includes(app))) return { action:'open_app', payload:{app}, reply:`Vou abrir ${app} no celular.` };
  }

  m = raw.match(/https?:\/\/\S+/i);
  if (m && mobileExplicit) return { action:'open_url', payload:{url:m[0]}, reply:'Vou abrir esse link no celular.' };

  if (mobileExplicit && /\b(?:configuracoes|configurações|settings)\b/.test(t)) {
    const section = t.includes('wifi') ? 'wifi' : t.includes('bluetooth') ? 'bluetooth' : t.includes('notific') ? 'notifications' : '';
    return { action:'open_settings', payload:{section}, reply:'Vou abrir as configurações no celular.' };
  }

  return null;
}

export async function inferAndQueueAndroidAction(text = '') {
  const intent = detectAndroidIntent(text);
  if (!intent) return null;
  try {
    const command = await queueAndroidAction(intent.action, intent.payload);
    return { ...intent, commandId:command.id, targetDeviceId:command.target_device_id, queued:true };
  } catch (error) {
    if (error.message === 'NO_ANDROID_ONLINE') return { ...intent, queued:false, error:'NO_ANDROID_ONLINE' };
    throw error;
  }
}

export async function waitAndroidCommand(commandId, timeoutMs = 6500) {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  while (Date.now() < deadline) {
    const command = await getCommand(commandId);
    if (!command) return null;
    if (command.status === 'done' || command.status === 'failed') return command;
    await new Promise(resolve => setTimeout(resolve, 450));
  }
  return getCommand(commandId);
}

export function formatAndroidResult(actionContext, command) {
  if (!actionContext) return '';
  if (!actionContext.queued) return 'Entendi a ação, mas seu Android não apareceu online agora. Abra a SEXTA no celular e deixe o modo em segundo plano ativo.';
  if (!command || !['done','failed'].includes(command.status)) return actionContext.reply || 'Comando enviado para o Android.';
  if (command.status === 'failed') return `O Android recebeu o comando, mas não conseguiu concluir: ${command.result?.message || 'ação indisponível no aparelho'}.`;
  const result = command.result || {};
  if (actionContext.action === 'notification_reply') return `Pronto. Respondi ${result.recipient || actionContext.payload.recipient || 'a conversa'} pelo WhatsApp.`;
  if (actionContext.action === 'notification_list') {
    const items = Array.isArray(result.notifications) ? result.notifications : [];
    if (!items.length) return 'Não encontrei notificações recentes do WhatsApp.';
    const summary = items.slice(0,5).map(item => `${item.title || 'Contato'}: ${item.text || ''}`).join(' | ');
    return `As mais recentes são: ${summary}`;
  }
  return actionContext.reply || 'Pronto, o Android concluiu a ação.';
}
