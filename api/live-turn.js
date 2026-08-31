import { isOwner, maybeExtractMemory, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';

function stripAssistantPrefix(text = '') {
  return String(text)
    .trim()
    .replace(/^sexta(?:[- ]feira)?\s*[,;:.-]?\s*/i, '')
    .trim();
}

function classifyMemory(content = '') {
  const text = String(content).toLowerCase();
  if (/\b(anivers[aá]rio|nascimento|data especial|evento|reuni[aã]o|consulta|compromisso|dia \d{1,2}|\d{1,2} de [a-zç]+)\b/i.test(text)) {
    return { kind: 'event', importance: 0.92 };
  }
  if (/\b(prefiro|prefer[eê]ncia|gosto|n[aã]o gosto|favorit[oa])\b/i.test(text)) {
    return { kind: 'preference', importance: 0.86 };
  }
  if (/\b(decidi|decis[aã]o|vamos usar|n[aã]o vamos usar|escolhi|escolhemos)\b/i.test(text)) {
    return { kind: 'decision', importance: 0.88 };
  }
  return { kind: 'fact', importance: 0.88 };
}

function extractLiveMemory(text = '') {
  const clean = stripAssistantPrefix(text);
  if (!clean) return null;

  // Preserve the older deterministic rules too, but run them after removing
  // "Sexta-feira" because voice transcription commonly includes the full wake name.
  const legacy = maybeExtractMemory(clean);
  if (legacy) return legacy;

  const patterns = [
    /^(?:salva|salve|salvar|guarda|guarde|guardar|anota|anote|anotar|memoriza|memorize|memorizar|registre|registrar)(?:\s+(?:isso|a[ií]))?(?:\s+(?:na|em)\s+(?:sua|minha)\s+mem[oó]ria)?(?:\s+agora)?\s*[,;:.-]*\s*(?:que\s+)?(.{5,})$/i,
    /^(?:atualiza|atualize|atualizar)\s+(?:a\s+)?(?:sua|minha)?\s*mem[oó]ria(?:\s+agora)?\s*[,;:.-]+\s*(.{5,})$/i,
    /^(?:coloca|coloque|adiciona|adicione|adicionar)\s+(?:isso\s+)?(?:na|em)\s+(?:sua|minha)\s+mem[oó]ria(?:\s+agora)?\s*[,;:.-]*\s*(?:que\s+)?(.{5,})$/i,
    /^(?:eu\s+)?(?:pedi|tinha pedido)\s+(?:para|pra)\s+voc[eê]\s+(?:salvar|guardar|anotar|lembrar)(?:\s+que)?\s+(.{5,})$/i,
    /^(?:quero|preciso)\s+que\s+voc[eê]\s+(?:salve|guarde|anote|lembre|memorize)(?:\s+que)?\s+(.{5,})$/i
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    const content = String(match?.[1] || '').trim();
    if (!content) continue;
    const { kind, importance } = classifyMemory(content);
    return { content, kind, importance, source: 'explicit_voice' };
  }

  return null;
}

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
    let memory = null;

    if (userText) {
      await saveMessage({ conversation_id: conversationId, role: 'user', content: userText, device_id: deviceId });
      memory = extractLiveMemory(userText);
      if (memory) {
        await saveMemory(memory);
        memorySaved = true;
      }
    }

    if (assistantText) {
      // A resposta do Gemini Live pertence ao mesmo dispositivo que iniciou
      // o turno. Isso evita que a UI interprete a própria SEXTA como um
      // "outro dispositivo" e mostre um handoff falso.
      await saveMessage({ conversation_id: conversationId, role: 'assistant', content: assistantText, device_id: deviceId });
    }

    return send(res, 200, {
      ok: true,
      memorySaved,
      memoryKind: memory?.kind || null,
      voiceEngine: 'gemini-live'
    });
  } catch (error) {
    console.error('Live turn persistence failed:', error);
    return send(res, 500, { error: 'live_turn_save_failed', message: error?.message || 'Não consegui guardar o turno de voz.' });
  }
}
