import { isOwner, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';
import { detectWorkspaceIntent, executeWorkspaceAction, formatWorkspaceResult, googleStatus } from '../lib/google.mjs';
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

async function persistActionTurn(text, reply, deviceId, source = 'tool-bus') {
  await saveMessage({ conversation_id: SHARED_CONVERSATION_ID, role: 'user', content: text, device_id: deviceId });
  if (reply) await saveMessage({ conversation_id: SHARED_CONVERSATION_ID, role: 'assistant', content: reply, device_id: source });
  await absorbAutomaticMemory({ userText: text, assistantText: reply, source: 'auto-voice-action' });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req).catch(() => ({}));
  const text = String(body.text || body.message || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  const deviceId = String(body.deviceId || 'android-native').slice(0, 120);
  if (!text) return send(res, 400, { error: 'text_required' });

  try {
    // Primary router: Gemini function calling. This understands natural language
    // and can choose/combine Android, Google, WhatsApp, PC and memory tools.
    try {
      const planned = await planAndExecuteTools(text, { deviceId, maxRounds: 4 });
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

    // Legacy intent routers remain as offline/degraded fallbacks.
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

    const workspaceIntent = detectWorkspaceIntent(text);
    if (workspaceIntent) {
      const status = await googleStatus();
      if (!status.configured) return send(res, 200, { handled: true, ok: false, provider: 'google-workspace', action: workspaceIntent.action, needsGoogleConfig: true, reply: 'O Google Workspace ainda não está configurado no servidor.' });
      if (!status.connected) return send(res, 200, { handled: true, ok: false, provider: 'google-workspace', action: workspaceIntent.action, needsGoogleConnect: true, reply: 'Sua conta Google ainda precisa ser autorizada nas Integrações.' });

      try {
        const result = await executeWorkspaceAction(workspaceIntent.action, workspaceIntent.args);
        if (workspaceIntent.action === 'calendar.create') {
          const title = String(workspaceIntent.args.title || '').trim();
          const date = String(workspaceIntent.args.date || '').trim();
          if (title && date) await saveMemory({ content: `${title}: ${date.split('-').reverse().join('/')}`, kind: 'event', importance: /anivers[aá]rio/i.test(title) ? 0.95 : 0.78, source: 'google-calendar' });
        }
        const reply = formatWorkspaceResult(workspaceIntent, result);
        await persistActionTurn(text, reply, deviceId, 'google-workspace');
        return send(res, 200, { handled: true, ok: true, provider: 'google-workspace', action: workspaceIntent.action, reply, result });
      } catch (error) {
        return send(res, 200, { handled: true, ok: false, provider: 'google-workspace', action: workspaceIntent.action, reply: `Não consegui executar no Google Workspace: ${error.message}` });
      }
    }

    return send(res, 200, { handled: false, ok: false });
  } catch (error) {
    console.error('Voice action router failed:', error);
    return send(res, 500, { error: 'voice_action_failed', message: error?.message || 'Falha ao rotear a ação de voz.' });
  }
}
