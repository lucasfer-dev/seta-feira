import { isOwner, maybeExtractMemory, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req);
  const conversationId = String(body.conversationId || 'main').slice(0, 100);
  const deviceId = String(body.deviceId || 'live-voice').slice(0, 120);
  const userText = String(body.userText || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  const assistantText = String(body.assistantText || '').replace(/\s+/g, ' ').trim().slice(0, 12000);

  if (!userText && !assistantText) return send(res, 400, { error: 'transcript_required' });

  try {
    let memorySaved = false;
    if (userText) {
      await saveMessage({ conversation_id: conversationId, role: 'user', content: userText, device_id: deviceId });
      const memory = maybeExtractMemory(userText);
      if (memory) {
        await saveMemory(memory);
        memorySaved = true;
      }
    }
    if (assistantText) {
      await saveMessage({ conversation_id: conversationId, role: 'assistant', content: assistantText, device_id: 'gemini-live' });
    }
    return send(res, 200, { ok: true, memorySaved });
  } catch (error) {
    console.error('Live turn persistence failed:', error);
    return send(res, 500, { error: 'live_turn_save_failed', message: error?.message || 'Não consegui guardar o turno de voz.' });
  }
}
