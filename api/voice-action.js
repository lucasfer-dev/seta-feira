import { getMemories, getMessages, isOwner, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';
import { detectWorkspaceIntent, executeWorkspaceAction, formatWorkspaceResult, googleStatus } from '../lib/google.mjs';
import { getConnectedGoogleAccount, isGoogleAccountQuestion } from '../lib/google-account.mjs';
import { detectWhatsAppIntent, evolutionStatus, sendWhatsAppText } from '../lib/evolution.mjs';
import { absorbAutomaticMemory } from '../lib/auto-memory.mjs';
import { planAndExecuteTools } from '../lib/tool-bus.mjs';

const SHARED_CONVERSATION_ID = 'main';

function plannerReply(planned) {
  if (planned?.modelText) return planned.modelText;
  const last = planned?.results?.at?.(-1)?.result;
  if (last?.message) return String(last.message);
  if (last?.ok === false) return `Não consegui concluir: ${last.error || 'ferramenta indisponível'}.`;
  if (planned?.calls?.length) return planned.calls.length === 1 ? 'Pronto, executei a ação.' : `Pronto, executei ${planned.calls.length} ações.`;
  return '';
}

function normalizeSpokenEmail(value = '') {
  const raw = String(value || '').trim();
  if (!/\barroba\b/i.test(raw)) return raw;
  return raw
    .replace(/\s+arroba\s+/gi, '@')
    .replace(/\s+ponto\s+/gi, '.')
    .replace(/\s+/g, '')
    .trim();
}

function detectExplicitEmailIntent(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || !/\b(?:e-?mail|gmail)\b/i.test(raw) || !/\b(?:manda|mande|mandar|envia|envie|enviar)\b/i.test(raw)) return null;

  let match = raw.match(/\b(?:manda|mande|mandar|envia|envie|enviar)\b\s+(?:um\s+)?(?:e-?mail|gmail)\s+(?:para|pra|pro|ao|à)\s+(.+?)\s+(?:com\s+(?:o\s+)?assunto\s+(.+?)\s+e\s+(?:a\s+)?(?:mensagem|texto)|dizendo|falando|com\s+(?:a\s+)?(?:mensagem|texto)|mensagem)\s+(.+)$/i);
  if (match) {
    const recipient = normalizeSpokenEmail(match[1]);
    const subject = String(match[2] || 'Mensagem da Sexta-feira').trim();
    const body = String(match[3] || '').trim();
    if (recipient && body) return { action: 'gmail.send-smart', args: { recipient, subject, body } };
  }

  match = raw.match(/\b(?:manda|mande|mandar|envia|envie|enviar)\b\s+(?:um\s+)?(?:e-?mail|gmail)\s+(?:para|pra|pro|ao|à)\s+(.+?)\s+(?:dizendo|falando|com\s+(?:a\s+)?(?:mensagem|texto)|mensagem)\s+(.+)$/i);
  if (match?.[1] && match?.[2]) {
    return {
      action: 'gmail.send-smart',
      args: {
        recipient: normalizeSpokenEmail(match[1]),
        subject: 'Mensagem da Sexta-feira',
        body: match[2].trim()
      }
    };
  }

  match = raw.match(/\b(?:manda|mande|mandar|envia|envie|enviar)\b\s+(?:para|pra|pro|ao|à)\s+(.+?)\s+(?:um\s+)?(?:e-?mail|gmail)\s+(?:dizendo|falando|com\s+(?:a\s+)?(?:mensagem|texto)|mensagem)\s+(.+)$/i);
  if (match?.[1] && match?.[2]) {
    return {
      action: 'gmail.send-smart',
      args: {
        recipient: normalizeSpokenEmail(match[1]),
        subject: 'Mensagem da Sexta-feira',
        body: match[2].trim()
      }
    };
  }

  const recipientOnly = raw.match(/\b(?:manda|mande|mandar|envia|envie|enviar)\b\s+(?:um\s+)?(?:e-?mail|gmail)\s+(?:para|pra|pro|ao|à)\s+(.+?)\s*$/i);
  if (recipientOnly?.[1]) {
    return {
      incomplete: true,
      recipient: normalizeSpokenEmail(recipientOnly[1])
    };
  }

  return null;
}

async function contextualPlannerInput(text) {
  const [messages, memories] = await Promise.all([
    getMessages(SHARED_CONVERSATION_ID, 10).catch(() => []),
    getMemories(10).catch(() => [])
  ]);
  const recent = messages.slice(-9).map(m => `${m.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${m.content}`).join('\n');
  const memoryText = memories.map(m => `- ${m.content}`).join('\n');
  return [
    'Você é o roteador de ferramentas da SEXTA. Use o contexto somente para entender referências do pedido atual. Não repita uma ação antiga só porque ela aparece no histórico.',
    memoryText ? `MEMÓRIAS RELEVANTES:\n${memoryText}` : '',
    recent ? `CONVERSA RECENTE:\n${recent}` : '',
    `PEDIDO ATUAL:\n${text}`
  ].filter(Boolean).join('\n\n');
}

async function persistActionTurn(text, reply, deviceId, source = 'tool-bus') {
  await saveMessage({ conversation_id: SHARED_CONVERSATION_ID, role: 'user', content: text, device_id: deviceId });
  if (reply) await saveMessage({ conversation_id: SHARED_CONVERSATION_ID, role: 'assistant', content: reply, device_id: source });
  await absorbAutomaticMemory({ userText: text, assistantText: reply, source: 'auto-voice-action' });
}

async function executeGoogleVoiceIntent(intent, text, deviceId) {
  const status = await googleStatus();
  if (!status.configured) return { handled: true, ok: false, provider: 'google-workspace', action: intent.action, needsGoogleConfig: true, reply: 'O Google Workspace ainda não está configurado no servidor.' };
  if (!status.connected) return { handled: true, ok: false, provider: 'google-workspace', action: intent.action, needsGoogleConnect: true, reply: 'Sua conta Google ainda precisa ser autorizada nas Integrações.' };

  try {
    const result = await executeWorkspaceAction(intent.action, intent.args);
    if (intent.action === 'calendar.create') {
      const title = String(intent.args.title || '').trim();
      const date = String(intent.args.date || '').trim();
      if (title && date) await saveMemory({ content: `${title}: ${date.split('-').reverse().join('/')}`, kind: 'event', importance: /anivers[aá]rio/i.test(title) ? 0.95 : 0.78, source: 'google-calendar' });
    }
    const reply = formatWorkspaceResult(intent, result);
    await persistActionTurn(text, reply, deviceId, 'google-workspace');
    return { handled: true, ok: true, provider: 'google-workspace', action: intent.action, reply, result };
  } catch (error) {
    return { handled: true, ok: false, provider: 'google-workspace', action: intent.action, reply: `Não consegui executar no Google Workspace: ${error.message}` };
  }
}

async function answerGoogleAccountQuestion(text, deviceId) {
  const status = await googleStatus();
  if (!status.configured) return { handled: true, ok: false, provider: 'google-workspace', action: 'google.account', reply: 'O Google Workspace ainda não está configurado no servidor.' };
  if (!status.connected) return { handled: true, ok: false, provider: 'google-workspace', action: 'google.account', needsGoogleConnect: true, reply: 'Nenhuma conta Google está conectada agora.' };
  try {
    const account = await getConnectedGoogleAccount();
    const reply = account.email
      ? `A conta Google conectada é ${account.email}${account.name ? `, de ${account.name}` : ''}.`
      : 'A conta Google está conectada, mas o Google não retornou o endereço de e-mail.';
    await persistActionTurn(text, reply, deviceId, 'google-workspace');
    return { handled: true, ok: true, provider: 'google-workspace', action: 'google.account', reply, result: account };
  } catch (error) {
    return { handled: true, ok: false, provider: 'google-workspace', action: 'google.account', reply: `A conta Google está conectada, mas não consegui consultar o perfil agora: ${error.message}` };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req).catch(() => ({}));
  const text = String(body.text || body.message || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  const deviceId = String(body.deviceId || 'android-native').slice(0, 120);
  if (!text) return send(res, 400, { error: 'text_required' });

  try {
    if (isGoogleAccountQuestion(text)) {
      return send(res, 200, await answerGoogleAccountQuestion(text, deviceId));
    }

    const explicitEmailIntent = detectExplicitEmailIntent(text);
    if (explicitEmailIntent?.incomplete) {
      return send(res, 200, {
        handled: true,
        ok: false,
        provider: 'google-workspace',
        action: 'gmail.send-smart',
        needsEmailBody: true,
        recipient: explicitEmailIntent.recipient,
        reply: `Qual mensagem você quer enviar por e-mail para ${explicitEmailIntent.recipient}?`
      });
    }
    if (explicitEmailIntent) {
      return send(res, 200, await executeGoogleVoiceIntent(explicitEmailIntent, text, deviceId));
    }

    const workspaceIntent = detectWorkspaceIntent(text);
    if (workspaceIntent) {
      return send(res, 200, await executeGoogleVoiceIntent(workspaceIntent, text, deviceId));
    }

    try {
      const planned = await planAndExecuteTools(await contextualPlannerInput(text), { deviceId: '', maxRounds: 4 });
      if (planned.handled) {
        const reply = plannerReply(planned);
        await persistActionTurn(text, reply, deviceId);
        const ok = !planned.results.some(item => item?.result?.ok === false);
        return send(res, 200, {
          handled: true,
          ok,
          provider: 'sexta-tool-bus',
          action: planned.calls?.[0]?.name || 'multi_tool',
          calls: planned.calls,
          results: planned.results,
          reply
        });
      }
    } catch (error) {
      console.warn('[SEXTA Voice ToolBus] usando fallback:', error.message);
    }

    const whatsappIntent = detectWhatsAppIntent(text);
    if (whatsappIntent) {
      const status = evolutionStatus();
      if (!status.configured) {
        return send(res, 200, { handled: true, ok: false, provider: 'evolution', action: whatsappIntent.action, needsEvolutionConnect: true, reply: 'A Evolution API ainda não está configurada.' });
      }

      try {
        const sent = await sendWhatsAppText(whatsappIntent.args);
        const reply = `Enviado no WhatsApp para ${sent.to.label}.`;
        await persistActionTurn(text, reply, deviceId, 'whatsapp-evolution');
        return send(res, 200, { handled: true, ok: true, provider: 'evolution', action: whatsappIntent.action, reply, result: { to: sent.to } });
      } catch (error) {
        if (error.message === 'WHATSAPP_RECIPIENT_AMBIGUOUS') {
          const candidates = error.candidates || [];
          const names = candidates.map(x => `${x.name} (${x.phone})`).join(', ');
          return send(res, 200, { handled: true, ok: false, provider: 'evolution', action: whatsappIntent.action, needsRecipientChoice: true, candidates, reply: `Encontrei mais de um telefone para esse contato: ${names}.` });
        }
        return send(res, 200, { handled: true, ok: false, provider: 'evolution', action: whatsappIntent.action, reply: `Não consegui executar no WhatsApp: ${error.message}` });
      }
    }

    return send(res, 200, { handled: false, ok: false });
  } catch (error) {
    console.error('Voice action router failed:', error);
    return send(res, 500, { error: 'voice_action_failed', message: error?.message || 'Falha ao rotear a ação de voz.' });
  }
}
