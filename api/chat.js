import { answer, inferAndQueueSafeAction, isOwner, maybeExtractMemory, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';
import { detectWorkspaceIntent, executeWorkspaceAction, formatWorkspaceResult, googleStatus } from '../lib/google.mjs';
import { detectWhatsAppIntent, evolutionStatus, sendWhatsAppText } from '../lib/evolution.mjs';

const SHARED_CONVERSATION_ID = 'main';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  const body = await parseJson(req);
  const message = String(body.message || '').trim();
  const conversationId = SHARED_CONVERSATION_ID;
  const deviceId = String(body.deviceId || 'unknown').slice(0, 120);
  if (!message) return send(res, 400, { error: 'message_required' });
  try {
    await saveMessage({ conversation_id: conversationId, role: 'user', content: message, device_id: deviceId });
    const memory = maybeExtractMemory(message);
    if (memory) await saveMemory(memory);
    const whatsappIntent = detectWhatsAppIntent(message);
    if (whatsappIntent) {
      if (!evolutionStatus().configured) {
        const reply = 'Eu entendi que você quer mandar uma mensagem pelo WhatsApp, mas a Evolution API ainda não está configurada. Abra Integrações e conecte o WhatsApp.';
        await saveMessage({ conversation_id: conversationId, role: 'assistant', content: reply, device_id: 'cloud-core' });
        return send(res, 200, { reply, needsEvolutionConnect:true, memorySaved:Boolean(memory) });
      }
      try {
        const sent = await sendWhatsAppText(whatsappIntent.args);
        const reply = `Enviado no WhatsApp para ${sent.to.label}.`;
        await saveMessage({ conversation_id: conversationId, role: 'assistant', content: reply, device_id: 'whatsapp-evolution' });
        return send(res, 200, { reply, whatsappAction:whatsappIntent, whatsappResult:{to:sent.to}, memorySaved:Boolean(memory) });
      } catch (error) {
        if (error.message === 'WHATSAPP_RECIPIENT_AMBIGUOUS') {
          const names=(error.candidates||[]).map(x=>`${x.name} (${x.phone})`).join(', ');
          const reply=`Encontrei mais de um telefone para esse contato: ${names}. Me diga qual deles.`;
          await saveMessage({ conversation_id:conversationId, role:'assistant', content:reply, device_id:'whatsapp-evolution' });
          return send(res,200,{reply,whatsappCandidates:error.candidates||[]});
        }
        throw error;
      }
    }
    const workspaceIntent = detectWorkspaceIntent(message);
    if (workspaceIntent && googleStatus().connected) {
      const workspaceResult = await executeWorkspaceAction(workspaceIntent.action, workspaceIntent.args);
      if (workspaceIntent.action === 'calendar.create') {
        const title = String(workspaceIntent.args.title || '').trim();
        const date = String(workspaceIntent.args.date || '').trim();
        if (title && date) await saveMemory({ content: `${title}: ${date.split('-').reverse().join('/')}`, kind: 'event', importance: /anivers[aá]rio/i.test(title) ? 0.95 : 0.78, source: 'google-calendar' });
      }
      const reply = formatWorkspaceResult(workspaceIntent, workspaceResult);
      await saveMessage({ conversation_id: conversationId, role: 'assistant', content: reply, device_id: 'google-workspace' });
      return send(res, 200, { reply, workspaceAction: workspaceIntent, workspaceResult, memorySaved: Boolean(memory) });
    }
    if (workspaceIntent && !googleStatus().connected) {
      const reply = googleStatus().configured
        ? 'Eu entendi que isso é uma ação do Google Workspace, mas sua conta Google ainda não está conectada. Abra Integrações e autorize o acesso.'
        : 'Eu entendi a ação do Google, mas o OAuth ainda não foi configurado. Falta colocar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.';
      await saveMessage({ conversation_id: conversationId, role: 'assistant', content: reply, device_id: 'cloud-core' });
      return send(res, 200, { reply, needsGoogleConnect: true, memorySaved: Boolean(memory) });
    }
    const actionContext = await inferAndQueueSafeAction(message);
    const reply = await answer({
      message, conversationId, deviceId,
      settings: body.settings || {}, clientContext: body.context || {}, actionContext
    });
    await saveMessage({ conversation_id: conversationId, role: 'assistant', content: reply, device_id: 'cloud-core' });
    send(res, 200, { reply, action: actionContext, memorySaved: Boolean(memory), conversationId });
  } catch (error) {
    console.error(error);
    if (String(error?.message || '').startsWith('GEMINI_NETWORK:')) {
      return send(res, 503, {
        error: 'ai_network_unavailable',
        message: 'Não consegui alcançar o Gemini agora. Seus comandos e respostas locais continuam funcionando.'
      });
    }
    if (String(error?.message || '').startsWith('GEMINI_UNAVAILABLE:')) {
      return send(res, 503, {
        error: 'ai_temporarily_unavailable',
        message: 'Meus cérebros do Gemini estão congestionados agora. Seus comandos locais continuam funcionando; tente a conversa novamente em instantes.'
      });
    }
    send(res, Number(error?.status) || 500, { error: 'chat_failed', message: error.message });
  }
}
