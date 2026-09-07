import { getMemories } from './core.mjs';

const STOP = new Set(['a','o','os','as','de','da','do','das','dos','e','em','no','na','nos','nas','um','uma','uns','umas','que','para','por','com','sem','eu','me','meu','minha','meus','minhas','voce','voces','sobre','isso','isto','aquele','aquela','mais','menos','muito','muita']);

function normalize(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(value = '') {
  return [...new Set(normalize(value).split(' ').filter(token => token.length > 1 && !STOP.has(token)))];
}
function similarity(a = '', b = '') {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const token of A) if (B.has(token)) hit += 1;
  return hit / Math.max(A.size, B.size);
}
function recencyScore(memory = {}) {
  const stamp = new Date(memory.updated_at || memory.created_at || 0).getTime();
  if (!stamp) return 0;
  const ageDays = Math.max(0, (Date.now() - stamp) / 86400000);
  return Math.max(0, 1 - ageDays / 180);
}

export async function searchMemories(query = '', { limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const all = await getMemories(200);
  const qTokens = new Set(tokens(q));
  const ranked = all.map(memory => {
    const text = String(memory.content || '');
    const mTokens = tokens(text);
    let overlap = 0;
    for (const token of mTokens) if (qTokens.has(token)) overlap += 1;
    const tokenScore = qTokens.size ? overlap / qTokens.size : 0;
    const phraseBoost = normalize(text).includes(normalize(q)) || normalize(q).includes(normalize(text)) ? 0.35 : 0;
    const importance = Math.max(0, Math.min(1, Number(memory.importance ?? 0.65)));
    const score = tokenScore * 0.58 + phraseBoost + importance * 0.22 + recencyScore(memory) * 0.2;
    return { memory, score };
  }).filter(item => item.score > 0.08).sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(1, Math.min(20, Number(limit) || 8))).map(item => ({
    id: item.memory.id,
    kind: item.memory.kind,
    content: item.memory.content,
    importance: item.memory.importance,
    source: item.memory.source,
    updatedAt: item.memory.updated_at || item.memory.created_at,
    relevance: Math.round(item.score * 1000) / 1000
  }));
}

export async function memoryHygieneStatus() {
  const all = await getMemories(200);
  const duplicates = [];
  const seen = new Set();
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i], b = all[j];
      const key = [a.id, b.id].sort().join(':');
      if (seen.has(key)) continue;
      const sim = similarity(a.content, b.content);
      if (sim >= 0.82) {
        seen.add(key);
        duplicates.push({
          similarity: Math.round(sim * 100) / 100,
          first: { id: a.id, kind: a.kind, content: a.content },
          second: { id: b.id, kind: b.kind, content: b.content }
        });
      }
    }
  }
  return {
    total: all.length,
    duplicatePairs: duplicates.length,
    duplicates: duplicates.slice(0, 20),
    recommendation: duplicates.length ? 'Há memórias potencialmente duplicadas; revise antes de excluir qualquer uma.' : 'Nenhuma duplicata forte detectada.'
  };
}
