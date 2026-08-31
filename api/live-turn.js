import { getMessages, isOwner, maybeExtractMemory, parseJson, saveMemory, saveMessage, send } from '../lib/core.mjs';

const SHARED_CONVERSATION_ID = 'main';

function stripAssistantPrefix(text = '') {
  return String(text)
    .trim()
    .replace(/^(?:(?:segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(?:[- ]feira)?)\s*[,;:.-]?\s*/i, '')
    .replace(/^sexta(?:[- ]feira)?\s*[,;:.-]?\s*/i, '')
    .replace(/^(?:ent[aã]o|por favor|pra mim|para mim)\s*[,;:.-]?\s*/i, '')
    .trim();
}

function normalizeMemorySpeech(text = '') {
  return stripAssistantPrefix(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const SAVE_VERB = '(?:salva|salve|salvar|guarda|guarde|guardar|anota|anote|anotar|memoriza|memorize|memorizar|registra|registre|registrar|adiciona|adicione|adicionar|coloca|coloque|lembrar|lembre)';

function hasMemoryIntent(text = '') {
  const value = normalizeMemorySpeech(text);
  if (!value) return false;
  return new RegExp(`\\b${SAVE_VERB}\\b`, 'i').test(value)
    || /\b(?:na|em)\s+(?:sua|minha)\s+memoria\b/i.test(value)
    || /\baba\s+memoria\b/i.test(value)
    || /\blembre-se\s+(?:disso|dessa|desta)\b/i.test(value);
}

function isReferenceMemoryRequest(text = '') {
  const value = normalizeMemorySpeech(text);
  if (!value || !hasMemoryIntent(value)) return false;
  return /\b(?:isso|essa informacao|esta informacao|essa coisa|isso ai|o que eu (?:acabei de )?falei|a informacao anterior|o que eu disse antes|de novo|na aba memoria)\b/i.test(value)
    && !/[.:]\s*[^.]{5,}$/.test(value);
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

function makeMemory(content, source = 'explicit_voice') {
  let value = String(content || '').replace(/\s+/g, ' ').trim();
  value = value
    .replace(/^\s*(?:que\s+)?/i, '')
    .replace(/^(?:na|em)\s+(?:sua|minha)\s+mem[oó]ria\s*(?:que\s+)?/i, '')
    .replace(/^na\s+aba\s+mem[oó]ria\s*(?:que\s+)?/i, '')
    .replace(/^[,;:.-]+\s*/, '')
    .trim();
  if (value.length < 5) return null;
  const normalized = normalizeMemorySpeech(value).replace(/[.!?]+$/g, '').trim();
  if (/^(?:isso|essa informacao|esta informacao|essa coisa|isso ai|na aba memoria|(?:na|em) (?:sua|minha) memoria)$/.test(normalized)) return null;
  const { kind, importance } = classifyMemory(value);
  return { content: value.slice(0, 2000), kind, importance, source };
}

function extractLiveMemory(text = '') {
  const clean = stripAssistantPrefix(text);
  if (!clean) return null;

  const legacy = maybeExtractMemory(clean);
  if (legacy) {
    const normalized = normalizeMemorySpeech(legacy.content).replace(/[.!?]+$/g, '').trim();
    if (!/^(?:isso|essa informacao|esta informacao|essa coisa|isso ai|na aba memoria)$/.test(normalized)) return legacy;
  }

  if (!hasMemoryIntent(clean)) return null;

  let match = clean.match(/\b(?:salva|salve|salvar|guarda|guarde|guardar|anota|anote|anotar|memoriza|memorize|memorizar|registra|registre|registrar|adiciona|adicione|adicionar|coloca|coloque)\b[\s\S]{0,120}?\b(?:essa|esta)\s+informa[cç][aã]o\b\s*[.:;-]+\s*(.{5,})$/i);
  if (match?.[1]) return makeMemory(match[1]);

  match = clean.match(/\b(?:salva|salve|salvar|guarda|guarde|guardar|anota|anote|anotar|memoriza|memorize|memorizar|registra|registre|registrar|adiciona|adicione|adicionar|coloca|coloque)\b(?:\s+(?:isso|ai|pra mim|para mim|na sua mem[oó]ria|na minha mem[oó]ria|em sua mem[oó]ria|em minha mem[oó]ria|na aba mem[oó]ria))*\s*[,;:.-]*\s*(?:que\s+)?(.{5,})$/i);
  if (match?.[1] && !/^(?:essa|esta)\s+informa[cç][aã]o\b/i.test(match[1])) {
    const memory = makeMemory(match[1]);
    if (memory) return memory;
  }

  match = clean.match(/\b(?:quero|preciso)\s+que\s+voc[eê]\s+(?:salve|guarde|anote|lembre|memorize|registre)(?:\s+que)?\s+(.{5,})$/i);
  if (match?.[1]) return makeMemory(match[1]);

  const rememberIndex = clean.search(/\blembre(?:-se)?\s+(?:disso|dessa|desta)\b/i);
  if (rememberIndex > 0) {
    const before = clean.slice(0, rememberIndex).replace(/[.!?\s]+$/g, '').trim();
    const sentences = before.split(/[.!?]+/).map(x => x.trim()).filter(Boolean);
    const candidate = sentences.at(-1) || before;
    const memory = makeMemory(candidate);
    if (memory) return memory;
  }

  return null;
}

function resolveReferencedMemory(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const memory = extractLiveMemory(message.content);
    if (memory) return { ...memory, source: 'explicit_voice_reference' };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req);
  const conversationId = SHARED_CONVERSATION_ID;
  const deviceId = String(body.deviceId || 'live-voice').slice(0, 120);
  const userText = String(body.userText || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  const assistantText = String(body.assistantText || '').replace(/\s+/g, ' ').trim().slice(0, 12000);

  if (!userText && !assistantText) return send(res, 400, { error: 'transcript_required' });

  try {
    let memorySaved = false;
    let memory = null;
    let recentMessages = [];

    if (userText && isReferenceMemoryRequest(userText)) {
      recentMessages = await getMessages(conversationId, 60);
      memory = resolveReferencedMemory(recentMessages);
    }

    if (userText) {
      await saveMessage({ conversation_id: conversationId, role: 'user', content: userText, device_id: deviceId });
      if (!memory) memory = extractLiveMemory(userText);
      if (memory) {
        await saveMemory(memory);
        memorySaved = true;
      }
    }

    if (assistantText) {
      await saveMessage({ conversation_id: conversationId, role: 'assistant', content: assistantText, device_id: deviceId });
    }

    return send(res, 200, {
      ok: true,
      conversationId,
      memorySaved,
      memoryKind: memory?.kind || null,
      memoryResolvedFromContext: Boolean(memory && recentMessages.length),
      voiceEngine: 'gemini-live'
    });
  } catch (error) {
    console.error('Live turn persistence failed:', error);
    return send(res, 500, { error: 'live_turn_save_failed', message: error?.message || 'Não consegui guardar o turno de voz.' });
  }
}
