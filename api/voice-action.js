import { getMemories, getMessages, isOwner, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';
import { detectWorkspaceIntent, executeWorkspaceAction, formatWorkspaceResult, googleStatus } from '../lib/google.mjs';
import { getConnectedGoogleAccount, isGoogleAccountQuestion } from '../lib/google-account.mjs';
import { detectWhatsAppIntent, evolutionStatus } from '../lib/evolution.mjs';
import { absorbAutomaticMemory } from '../lib/auto-memory.mjs';
import { executeTool, planAndExecuteTools } from '../lib/tool-bus.mjs';

const SHARED_CONVERSATION_ID = 'main';

function confirmationIntent(text = '') {
  const value = String(text || '').trim().toLocaleLowerCase('pt-BR');
  if (/^(?:sim[, ]*)?(?:confirmo|confirmar|confirma|pode (?:fazer|enviar|executar)|pode sim|manda|envia)(?: isso)?[.! ]*$/.test(value)) return 'confirm_action';
  if (/^(?:não[, ]*)?(?:cancelar|cancela|cancele|desiste|deixa pra lá|não envia|não execute)[.! ]*$/.test(value)) return 'cancel_action';
  return '';
}

function workspaceSensitiveTool(intent = {}) {
  const names = {
    'gmail.send-smart': 'google_send_email',
    'calendar.create': 'google_calendar_create',
    'docs.create': 'google_docs_create',
    'sheets.create': 'google_sheets_create',
    'tasks.create': 'google_task_create'
  };
  const name = names[intent.action];
  return name ? { name, args: intent.args || {} } : null;
}

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

function detectDirectAddressEmailIntent(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/\b(?:manda|mande|mandar|envia|envie|enviar)\b/i.test(raw)) return null;
  if (!/\b(?:e-?mail|gmail)\b/i.test(raw)) return null;

  const addressMatch = raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (!addressMatch?.[1]) return null;

  const recipient = addressMatch[1].replace(/[),.;:!?]+$/g, '').trim();
  let body = 'Teste da SEXTA';
  let subject = 'Teste da SEXTA';

  const beforeAddress = raw.slice(0, addressMatch.index).trim();
  const testBody = beforeAddress.match(/\b(?:e-?mail|gmail)\s+de\s+(.+?)\s+(?:para|pra|pro|ao|à)\s*$/i);
  if (testBody?.[1]) {
    body = testBody[1].trim();
    subject = /\bteste\b/i.test(body) ? 'Teste da SEXTA' : 'Mensagem da Sexta-feira';
  }

  const afterAddress = raw.slice((addressMatch.index || 0) + addressMatch[0].length).trim();
  const trailingBody = afterAddress.match(/^(?:dizendo|falando|com\s+(?:a\s+)?(?:mensagem|texto)|mensagem)\s+(.+)$/i);
  if (trailingBody?.[1]) {
    body = trailingBody[1].trim();
    subject = 'Mensagem da Sexta-feira';
  }

  return { action: 'gmail.send-smart', args: { recipient, subject, body } };
}

function detectExplicitEmailIntent(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw || !/\b(?:e-?mail|gmail)\b/i.test(raw) || !/\b(?:manda|mande|mandar|envia|envie|enviar)\b/i.test(raw)) return null;

  let match = raw.match(/\b(?:manda|mande|mandar|envia|envie|enviar)\b\s+(?:um\s+)?(?:e-?mail|gmail)\s+de\s+(.+?)\s+(?:para|pra|pro|ao|à)\s+([^\s,;]+@[^\s,;]+)\s*$/i);
  if (match?.[1] && match?.[2]) {
    const body = String(match[1]).trim();
    return {
      action: 'gmail.send-smart',
      args: {
        recipient: normalizeSpokenEmail(match[2]),
        subject: /\bteste\b/i.test(body) ? 'Teste da SEXTA' : 'Mensagem da Sexta-feira',
        body
      }
    };
  }

  match = raw.match(/\b(?:manda|mande|mandar|envia|envie|enviar)\b\s+(?:um\s+)?(?:e-?mail|gmail)\s+(?:para|pra|pro|ao|à)\s+(.+?)\s+(?:com\s+(?:o\s+)?assunto\s+(.+?)\s+e\s+(?:a\s+)?(?:mensagem|texto)|dizendo|falando|com\s+(?:a\s+)?(?:mensagem|texto)|mensagem)\s+(.+)$/i);
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
    const sensitive = workspaceSensitiveTool(intent);
    if (sensitive) {
      const proposed = await executeTool(sensitive.name, sensitive.args, { deviceId });
      if (proposed.confirmationRequired) {
        await persistActionTurn(text, proposed.message, deviceId, 'confirmation');
        return { handled: true, ok: true, provider: 'confirmation', action: intent.action, reply: proposed.message, confirmation: proposed };
      }
    }
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
    const confirmation = confirmationIntent(text);
    if (confirmation) {
      const result = await executeTool(confirmation, {}, { deviceId });
      const reply = result.message || (result.ok === false ? 'Não consegui processar essa confirmação.' : 'Certo.');
      await persistActionTurn(text, reply, deviceId, 'confirmation');
      return send(res, 200, { handled: true, ok: result.ok !== false, provider: 'confirmation', action: confirmation, reply, result });
    }

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

    const directAddressIntent = detectDirectAddressEmailIntent(text);
    if (directAddressIntent) {
      return send(res, 200, await executeGoogleVoiceIntent(directAddressIntent, text, deviceId));
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
      const planned = await planAndExecuteTools(await contextualPlannerInput(text), { deviceId, maxRounds: 4 });
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
        const result = await executeTool('whatsapp_send_message', whatsappIntent.args, { deviceId });
        if (result.confirmationRequired) {
          const reply = result.message;
          await persistActionTurn(text, reply, deviceId, 'confirmation');
          return send(res, 200, { handled: true, ok: true, provider: 'confirmation', action: whatsappIntent.action, reply, confirmation: result });
        }
        if (result.ok === false) throw new Error(result.error || 'WHATSAPP_SEND_FAILED');
        const reply = result.message || 'Mensagem enviada no WhatsApp.';
        await persistActionTurn(text, reply, deviceId, 'whatsapp-evolution');
        return send(res, 200, { handled: true, ok: true, provider: 'evolution', action: whatsappIntent.action, reply, result: result.result });
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
