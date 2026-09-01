import { answer, getMemories, getMessages, inferAndQueueSafeAction, isOwner, maybeExtractMemory, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';
import { detectWorkspaceIntent, executeWorkspaceAction, formatWorkspaceResult, googleStatus } from '../lib/google.mjs';
import { getConnectedGoogleAccount, isGoogleAccountQuestion } from '../lib/google-account.mjs';
import { detectWhatsAppIntent, evolutionStatus } from '../lib/evolution.mjs';
import { absorbAutomaticMemory } from '../lib/auto-memory.mjs';
import { executeTool, planAndExecuteTools } from '../lib/tool-bus.mjs';

const SHARED_CONVERSATION_ID = 'main';

function likelyAction(text = '') {
  return /\b(manda|mande|envia|envie|avisa|avise|fala|diz|abre|abra|abrir|fecha|liga|desliga|aumenta|abaixa|volume|lanterna|spotify|whatsapp|wpp|gmail|e-?mail|agenda|calend[aá]rio|reuni[aã]o|evento|drive|documento|planilha|tarefa|contato|pc|computador|celular|android|notifica[cç][aã]o|responde|responda|procura|busca|consulta|cria|crie|marca|marque|coloca|coloque|mostra|ver|veja|ler|leia|confirma|confirmo|cancelar|cancela)\b/i.test(String(text));
}

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

function detectDirectAddressEmailIntent(text = '') {
  const raw = String(text || '').replace(/\\@/g, '@').replace(/\s+/g, ' ').trim();
  if (!/\b(?:manda|mande|mandar|envia|envie|enviar)\b/i.test(raw)) return null;
  if (!/\b(?:e-?mail|gmail)\b/i.test(raw)) return null;

  const addressMatch = raw.match(/([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i);
  if (!addressMatch?.[1]) return null;

  const recipient = addressMatch[1].replace(/[),.;:!?]+$/g, '').trim();
  let body = 'Teste da SEXTA';
  let subject = 'Teste da SEXTA';

  const beforeAddress = raw.slice(0, addressMatch.index).trim();
  const describedBody = beforeAddress.match(/\b(?:e-?mail|gmail)\s+(?:de\s+)?(.+?)\s+(?:para|pra|pro|ao|à)\s*$/i);
  if (describedBody?.[1]) {
    const candidate = describedBody[1].replace(/^(?:um|uma)\s+/i, '').trim();
    if (candidate && !/^(?:para|pra|pro)$/i.test(candidate)) {
      body = candidate;
      subject = /\bteste\b/i.test(candidate) ? 'Teste da SEXTA' : 'Mensagem da Sexta-feira';
    }
  }

  const afterAddress = raw.slice((addressMatch.index || 0) + addressMatch[0].length).trim();
  const trailingBody = afterAddress.match(/^(?:dizendo|falando|com\s+(?:a\s+)?(?:mensagem|texto)|mensagem)\s+(.+)$/i);
  if (trailingBody?.[1]) {
    body = trailingBody[1].trim();
    subject = 'Mensagem da Sexta-feira';
  }

  return { action: 'gmail.send-smart', args: { recipient, subject, body } };
}

function toolFallback(planned) {
  const last = planned?.results?.at?.(-1)?.result;
  if (last?.message) return String(last.message);
  if (last?.ok === false) return `Eu entendi a ação, mas não consegui concluir: ${last.error || 'ferramenta indisponível'}.`;
  if (planned?.calls?.length) return `Pronto. Executei ${planned.calls.length === 1 ? 'a ação' : `${planned.calls.length} ações`} pedida${planned.calls.length === 1 ? '' : 's'}.`;
  return '';
}

async function plannerInput(message, conversationId) {
  const [messages, memories] = await Promise.all([
    getMessages(conversationId, 10).catch(() => []),
    getMemories(10).catch(() => [])
  ]);
  const normalizedCurrent = String(message || '').replace(/\s+/g, ' ').trim();
  const history = messages.slice(-10);
  const last = history.at(-1);
  if (last?.role === 'user' && String(last.content || '').replace(/\s+/g, ' ').trim() === normalizedCurrent) history.pop();
  const recent = history.slice(-9).map(m => `${m.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${m.content}`).join('\n');
  const memoryText = memories.map(m => `- ${m.content}`).join('\n');
  return [
    'Você é o roteador de ferramentas da SEXTA. Use o contexto abaixo apenas para resolver referências como "o mesmo", "aquele arquivo", "ela", "ele" ou nomes já citados. Execute somente o pedido atual.',
    'Nunca substitua um endereço de e-mail explícito por busca de contato. Se houver um endereço com @, use esse endereço diretamente.',
    memoryText ? `MEMÓRIAS RELEVANTES:\n${memoryText}` : '',
    recent ? `CONVERSA RECENTE:\n${recent}` : '',
    `PEDIDO ATUAL:\n${message}`
  ].filter(Boolean).join('\n\n');
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

  const executeGoogleIntent = async (intent, memory) => {
    const workspaceStatus = await googleStatus();
    if (!workspaceStatus.connected) {
      const reply = workspaceStatus.configured
        ? 'Eu entendi que isso é uma ação do Google Workspace, mas sua conta Google ainda não está conectada. Abra Integrações e autorize o acesso.'
        : 'Eu entendi a ação do Google, mas o OAuth ainda não foi configurado.';
      await persistReply(reply);
      return send(res, 200, { reply, needsGoogleConnect: true, memorySaved: Boolean(memory) });
    }

    const sensitive = workspaceSensitiveTool(intent);
    if (sensitive) {
      const result = await executeTool(sensitive.name, sensitive.args, { deviceId });
      if (result.confirmationRequired) {
        const reply = result.message;
        await persistReply(reply, 'confirmation');
        return send(res, 200, { reply, confirmation: result, memorySaved: Boolean(memory) });
      }
    }

    const workspaceResult = await executeWorkspaceAction(intent.action, intent.args);
    if (intent.action === 'calendar.create') {
      const title = String(intent.args.title || '').trim();
      const date = String(intent.args.date || '').trim();
      if (title && date) await saveMemory({
        content: `${title}: ${date.split('-').reverse().join('/')}`,
        kind: 'event',
        importance: /anivers[aá]rio/i.test(title) ? 0.95 : 0.78,
        source: 'google-calendar'
      });
    }
    const reply = formatWorkspaceResult(intent, workspaceResult);
    const automatic = await persistReply(reply, 'google-workspace');
    return send(res, 200, { reply, workspaceAction: intent, workspaceResult, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
  };

  try {
    await saveMessage({ conversation_id: conversationId, role: 'user', content: message, device_id: deviceId });
    const memory = maybeExtractMemory(message);
    if (memory) await saveMemory(memory);

    const confirmation = confirmationIntent(message);
    if (confirmation) {
      const result = await executeTool(confirmation, {} , { deviceId });
      const reply = result.message || (result.ok === false ? 'Não consegui processar essa confirmação.' : 'Certo.');
      const automatic = await persistReply(reply, 'confirmation');
      return send(res, 200, { reply, confirmationResult: result, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
    }

    if (isGoogleAccountQuestion(message)) {
      const status = await googleStatus();
      if (!status.connected) {
        const reply = status.configured ? 'Nenhuma conta Google está conectada agora.' : 'O Google Workspace ainda não está configurado no servidor.';
        await persistReply(reply, 'google-workspace');
        return send(res, 200, { reply, needsGoogleConnect: true, memorySaved: Boolean(memory) });
      }
      const account = await getConnectedGoogleAccount();
      const reply = account.email
        ? `A conta Google conectada é ${account.email}${account.name ? `, de ${account.name}` : ''}.`
        : 'A conta Google está conectada, mas o Google não retornou o endereço de e-mail.';
      const automatic = await persistReply(reply, 'google-workspace');
      return send(res, 200, { reply, googleAccount: account, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
    }

    const directEmailIntent = detectDirectAddressEmailIntent(message);
    if (directEmailIntent) return executeGoogleIntent(directEmailIntent, memory);

    const workspaceIntent = detectWorkspaceIntent(message);
    if (workspaceIntent) return executeGoogleIntent(workspaceIntent, memory);

    const whatsappIntent = detectWhatsAppIntent(message);
    if (whatsappIntent) {
      if (!evolutionStatus().configured) {
        const reply = 'Eu entendi que você quer mandar uma mensagem pelo WhatsApp, mas a Evolution API ainda não está configurada. Abra Integrações e conecte o WhatsApp.';
        const automatic = await persistReply(reply);
        return send(res, 200, { reply, needsEvolutionConnect: true, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
      }
      try {
        const result = await executeTool('whatsapp_send_message', whatsappIntent.args, { deviceId });
        if (result.confirmationRequired) {
          const reply = result.message;
          const automatic = await persistReply(reply, 'confirmation');
          return send(res, 200, { reply, confirmation: result, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
        }
        if (result.ok === false) throw new Error(result.error || 'WHATSAPP_SEND_FAILED');
        const sent = result.result;
        const reply = result.message || 'Mensagem enviada no WhatsApp.';
        const automatic = await persistReply(reply, 'whatsapp-evolution');
        return send(res, 200, { reply, whatsappAction: whatsappIntent, whatsappResult: sent, memorySaved: Boolean(memory) || automatic.saved.length > 0 });
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

    if (likelyAction(message)) {
      try {
        const planned = await planAndExecuteTools(await plannerInput(message, conversationId), { deviceId: '', maxRounds: 4 });
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
