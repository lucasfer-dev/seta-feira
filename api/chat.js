import { answer, inferAndQueueSafeAction, isOwner, maybeExtractMemory, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';
import { detectWorkspaceIntent, executeWorkspaceAction, formatWorkspaceResult, googleStatus } from '../lib/google.mjs';
import { detectWhatsAppIntent, evolutionStatus, sendWhatsAppText } from '../lib/evolution.mjs';
import { absorbAutomaticMemory } from '../lib/auto-memory.mjs';
import { planAndExecuteTools } from '../lib/tool-bus.mjs';

const SHARED_CONVERSATION_ID = 'main';

function likelyAction(text = '') {
  return /\b(manda|mande|envia|envie|abre|abra|abrir|fecha|liga|desliga|aumenta|abaixa|volume|lanterna|spotify|whatsapp|wpp|gmail|e-?mail|agenda|calend[aá]rio|drive|documento|planilha|tarefa|contato|pc|computador|celular|android|notifica[cç][aã]o|responde|responda|procura|busca|cria|crie|mostra|ler|leia)\b/i.test(String(text));
}

function toolFallback(planned) {
  const last = planned?.results?.at?.(-1)?.result;
  if (last?.message) return String(last.message);
  if (last?.ok === false) return `Eu entendi a ação, mas não consegui concluir: ${last.error || 'ferramenta indisponível'}.`;
  if (planned?.calls?.length) return `Pronto. Executei ${planned.calls.length === 1 ? 'a ação' : `${planned.calls.length} ações`} pedida${planned.calls.length === 1 ? '' : 's'}.`;
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  const body = await parseJson(req);
  const message = String(body.message || '').trim();
  const conversationId = SHARED_CONVERSATION_ID;
  const deviceId = String(body.deviceId || 'unknown').slice(0, 120);
  if (!message) return send(res, 400, { error: 'message_required' });

  const persistReply = async (reply, source = 'cloud-core') => {
    await saveMessage({ conversation_id: conversationId, role: 'assistant', content: reply, device_id: source });
    const automatic = await absorbAutomaticMemory({ userText: message, assistantText: reply, source: 'auto-chat' });
    return automatic;
  };

  try {
    await saveMessage({ conversation_id: conversationId, role: 'user', content: message, device_id: deviceId });
    const memory = maybeExtractMemory(message);
    if (memory) await saveMemory(memory);

    // Gemini decides which tool to use. Regexes below remain only as a fallback
    // when the tool planner is unavailable or the model chooses no function.
    if (likelyAction(message)) {
      try {
        const planned = await planAndExecuteTools(message, { deviceId, maxRounds: 4 });
        if (planned.handled) {
          const reply = planned.modelText || toolFallback(planned);
          const automatic = await persistReply(reply, 'tool-bus');
          return send(res, 200, {
            reply,
            conversationId,
            toolCalls: planned.calls,
            toolResults: planned.results,
            memorySaved: Boolean(memory) || automatic.saved.length > 0,
            automaticMemoriesSaved: automatic.saved.length
          });
        }
      } catch (error) {
        console.warn('[SEXTA Tool Planner] fallback para roteadores antigos:', error.message);
      }
    }

    const whatsappIntent = detectWhatsAppIntent(message);
    if (whatsappIntent) {
      if (!evolutionStatus().configured) {
        const reply = 'Eu entendi que você quer mandar uma mensagem pelo WhatsApp, mas a Evolution API ainda não está configurada. Abra Integrações e conecte o WhatsApp.';
        const automatic = await persistReply(reply);
        return send(res, 200, { reply, needsEvolutionConnect: true, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
      }
      try {
        const sent = await sendWhatsAppText(whatsappIntent.args);
        const reply = `Enviado no WhatsApp para ${sent.to.label}.`;
        const automatic = await persistReply(reply, 'whatsapp-evolution');
        return send(res, 200, { reply, whatsappAction: whatsappIntent, whatsappResult: { to: sent.to }, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
      } catch (error) {
        if (error.message === 'WHATSAPP_RECIPIENT_AMBIGUOUS') {
          const names = (error.candidates || []).map(x => `${x.name} (${x.phone})`).join(', ');
          const reply = `Encontrei mais de um telefone para esse contato: ${names}. Me diga qual deles.`;
          await persistReply(reply, 'whatsapp-evolution');
          return send(res, 200, { reply, whatsappCandidates: error.candidates || [] });
        }
        throw error;
      }
    }

    const workspaceIntent = detectWorkspaceIntent(message);
    if (workspaceIntent) {
      const workspaceStatus = await googleStatus();
      if (workspaceStatus.connected) {
        const workspaceResult = await executeWorkspaceAction(workspaceIntent.action, workspaceIntent.args);
        if (workspaceIntent.action === 'calendar.create') {
          const title = String(workspaceIntent.args.title || '').trim();
          const date = String(workspaceIntent.args.date || '').trim();
          if (title && date) await saveMemory({
            content: `${title}: ${date.split('-').reverse().join('/')}`,
            kind: 'event',
            importance: /anivers[aá]rio/i.test(title) ? 0.95 : 0.78,
            source: 'google-calendar'
          });
        }
        const reply = formatWorkspaceResult(workspaceIntent, workspaceResult);
        const automatic = await persistReply(reply, 'google-workspace');
        return send(res, 200, { reply, workspaceAction: workspaceIntent, workspaceResult, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
      }

      const reply = workspaceStatus.configured
        ? 'Eu entendi que isso é uma ação do Google Workspace, mas sua conta Google ainda não está conectada. Abra Integrações e autorize o acesso.'
        : 'Eu entendi a ação do Google, mas o OAuth ainda não foi configurado.';
      await persistReply(reply);
      return send(res, 200, { reply, needsGoogleConnect: true, memorySaved: Boolean(memory) });
    }

    const actionContext = await inferAndQueueSafeAction(message);
    const reply = await answer({
      message, conversationId, deviceId,
      settings: body.settings || {}, clientContext: body.context || {}, actionContext
    });
    const automatic = await persistReply(reply);
    return send(res, 200, {
      reply,
      action: actionContext,
      memorySaved: Boolean(memory) || automatic.saved.length > 0,
      automaticMemoriesSaved: automatic.saved.length,
      conversationId
    });
  } catch (error) {
    console.error(error);
    if (String(error?.message || '').startsWith('GEMINI_NETWORK:')) {
      return send(res, 503, { error: 'ai_network_unavailable', message: 'Não consegui alcançar o Gemini agora. Seus comandos e respostas locais continuam funcionando.' });
    }
    if (String(error?.message || '').startsWith('GEMINI_UNAVAILABLE:')) {
      return send(res, 503, { error: 'ai_temporarily_unavailable', message: 'Meus cérebros do Gemini estão congestionados agora. Seus comandos locais continuam funcionando; tente novamente em instantes.' });
    }
    return send(res, Number(error?.status) || 500, { error: 'chat_failed', message: error.message });
  }
}
