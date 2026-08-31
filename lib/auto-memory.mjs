import { config, deleteMemory, getMemories, saveMemory } from './core.mjs';

const SENSITIVE = /\b(password|senha|token|cookie|chave\s+privada|private\s+key|api\s*key|secret|c[oó]digo\s+de\s+verifica[cç][aã]o|2fa|otp|cvv|cart[aã]o|cpf|rg|pix\s+key)\b/i;
const TEMPORARY = /\b(agora|daqui a pouco|neste momento|s[oó] hoje|por enquanto hoje)\b/i;

function normalize(value = '') {
  return String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function wordSet(value = '') {
  return new Set(normalize(value).split(' ').filter(word => word.length > 2));
}

function overlap(a = '', b = '') {
  const A = wordSet(a); const B = wordSet(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const word of A) if (B.has(word)) shared += 1;
  return shared / Math.max(A.size, B.size);
}

function safeCandidate(candidate = {}) {
  const content = String(candidate.content || '').replace(/\s+/g, ' ').trim();
  if (content.length < 8 || content.length > 900) return null;
  if (SENSITIVE.test(content)) return null;
  const importance = Math.max(0.45, Math.min(0.98, Number(candidate.importance) || 0.68));
  if (importance < 0.58) return null;
  const allowedKinds = new Set(['fact','preference','decision','event','goal','project','person','routine']);
  const kind = allowedKinds.has(String(candidate.kind || '')) ? String(candidate.kind) : 'fact';
  return {
    content,
    kind,
    importance: TEMPORARY.test(content) ? Math.min(importance, 0.62) : importance,
    replacesMemoryId: String(candidate.replacesMemoryId || '').trim() || null
  };
}

function extractJson(text = '') {
  const clean = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(clean); } catch {}
  const start = clean.indexOf('{'); const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(clean.slice(start, end + 1)); } catch {}
  }
  return { memories: [] };
}

async function askMemoryModel({ userText, assistantText, existing }) {
  const c = config();
  if (!c.geminiKey) return { memories: [] };
  const model = process.env.GEMINI_MEMORY_MODEL || c.geminiModel || 'gemini-3.7-flash';
  const current = existing.slice(0, 28).map(m => ({ id: m.id, kind: m.kind, content: m.content, updated_at: m.updated_at }));
  const prompt = `Você é o Memory Manager da assistente pessoal SEXTA. Analise um turno e extraia SOMENTE fatos duráveis que serão úteis em conversas futuras.\n\nREGRAS:\n- O usuário NÃO precisa dizer "lembre". Aprenda preferências, decisões, projetos, objetivos, relações/pessoas, rotina e compromissos importantes quando claramente afirmados.\n- Não salve conversa casual, perguntas, hipóteses, respostas do assistente, informação pública ou detalhes que provavelmente deixam de valer em minutos.\n- Nunca salve senhas, tokens, cookies, chaves, códigos de autenticação, números completos de documentos/cartões ou outros segredos.\n- Não invente fatos nem faça inferências sensíveis. Salve somente o que o usuário realmente afirmou ou decidiu.\n- Se a nova informação substituir/contradizer claramente uma memória existente, informe replacesMemoryId com o ID daquela memória.\n- Evite duplicatas.\n- Máximo 4 memórias por turno.\n- Retorne APENAS JSON válido no formato {"memories":[{"content":"...","kind":"fact|preference|decision|event|goal|project|person|routine","importance":0.0,"replacesMemoryId":null}]}.\n\nMEMÓRIAS EXISTENTES:\n${JSON.stringify(current)}\n\nUSUÁRIO:\n${String(userText || '').slice(0,6000)}\n\nRESPOSTA DA SEXTA (use apenas como contexto, nunca como fonte de fato pessoal):\n${String(assistantText || '').slice(0,5000)}`;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 }
    }),
    signal: AbortSignal.timeout(14000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AUTO_MEMORY_${response.status}: ${data?.error?.message || 'model failed'}`);
  const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p?.text || '').join('').trim();
  return extractJson(text);
}

export async function absorbAutomaticMemory({ userText = '', assistantText = '', source = 'auto-memory' } = {}) {
  const cleanUser = String(userText || '').replace(/\s+/g, ' ').trim();
  if (cleanUser.length < 5 || SENSITIVE.test(cleanUser)) return { saved: [], skipped: true };

  const existing = await getMemories(40);
  let proposal;
  try { proposal = await askMemoryModel({ userText: cleanUser, assistantText, existing }); }
  catch (error) {
    console.warn('[SEXTA Memory] extração automática falhou:', error.message);
    return { saved: [], error: error.message };
  }

  const saved = [];
  const deleted = [];
  const existingById = new Map(existing.map(m => [String(m.id), m]));
  for (const raw of Array.isArray(proposal?.memories) ? proposal.memories.slice(0, 4) : []) {
    const candidate = safeCandidate(raw);
    if (!candidate) continue;

    const duplicate = existing.find(m => normalize(m.content) === normalize(candidate.content) || overlap(m.content, candidate.content) >= 0.84);
    if (duplicate && candidate.replacesMemoryId !== String(duplicate.id)) continue;

    if (candidate.replacesMemoryId && existingById.has(candidate.replacesMemoryId)) {
      await deleteMemory(candidate.replacesMemoryId);
      deleted.push(candidate.replacesMemoryId);
      existingById.delete(candidate.replacesMemoryId);
    }

    const memory = await saveMemory({
      content: candidate.content,
      kind: candidate.kind,
      importance: candidate.importance,
      source
    });
    if (memory) saved.push(memory);
  }
  return { saved, deleted, skipped: false };
}
