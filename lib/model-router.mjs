import { config, getMemories, getMessages } from './core.mjs';
import { buildPersonalityContract, normalizePersonality } from '../public/sexta-personality.js';

export const MODEL_ROUTER_VERSION = '1.0.0';

const CODING_PATTERN = /\b(?:c[oó]digo|codex|bug|erro|stack|typescript|javascript|python|java|spring|react|next\.?js|node|sql|api|repo|reposit[oó]rio|programa[cç][aã]o|implementar|refatorar|debug|build|deploy)\b/i;
const REASONING_PATTERN = /\b(?:analisa|analisar|compare|comparar|arquitetura|estrat[eé]gia|planeja|planejar|roadmap|investiga|investigar|diagn[oó]stico|por que|porque|explica em detalhes|decis[aã]o|trade-?off)\b/i;
const FAST_PATTERN = /^(?:oi|ol[aá]|bom dia|boa tarde|boa noite|valeu|obrigad[oa]|teste|sim|n[aã]o|ok|blz|beleza)[!. ]*$/i;

function clean(text = '') { return String(text || '').replace(/\s+/g, ' ').trim(); }

export function classifyModelRoute(message = '', { actionContext = null } = {}) {
  const text = clean(message);
  if (actionContext) return 'fast';
  if (CODING_PATTERN.test(text)) return 'coding';
  if (REASONING_PATTERN.test(text) || text.length > 900) return 'reasoning';
  if (FAST_PATTERN.test(text) || text.length < 120) return 'fast';
  return 'fast';
}

export function modelRouterStatus() {
  const c = config();
  const routes = {
    fast: String(process.env.GEMINI_FAST_MODEL || c.geminiModel),
    reasoning: String(process.env.GEMINI_REASONING_MODEL || c.geminiModel),
    coding: String(process.env.GEMINI_CODE_MODEL || c.geminiModel)
  };
  return {
    version: MODEL_ROUTER_VERSION,
    enabled: process.env.SEXTA_MODEL_ROUTER_ENABLED !== 'false',
    provider: c.geminiKey ? 'gemini' : 'demo',
    defaultModel: c.geminiModel,
    routes,
    dedicatedRoutes: Object.fromEntries(Object.entries(routes).map(([key, value]) => [key, value !== c.geminiModel]))
  };
}

async function generateWithGemini({ model, message, conversationId, settings, actionContext, route }) {
  const c = config();
  const [history, memories] = await Promise.all([
    getMessages(conversationId, route === 'reasoning' ? 14 : 9).catch(() => []),
    getMemories(route === 'reasoning' ? 14 : 8).catch(() => [])
  ]);
  const memoryText = memories.map(item => `- ${item.content}`).join('\n');
  const routeRule = route === 'coding'
    ? 'MODO DE RACIOCÍNIO: programação. Priorize diagnóstico técnico, código correto, verificações e limitações concretas.'
    : route === 'reasoning'
      ? 'MODO DE RACIOCÍNIO: análise. Compare alternativas, explicite premissas importantes e entregue uma conclusão prática.'
      : 'MODO DE RACIOCÍNIO: resposta rápida. Seja natural, direta e curta quando a pergunta permitir.';
  const system = [
    buildPersonalityContract(normalizePersonality(settings || {}), { channel: 'chat-router', platform: 'cloud' }),
    routeRule,
    'Não alegue executar ações que não foram confirmadas por ferramentas.',
    memoryText ? `MEMÓRIAS RELEVANTES:\n${memoryText}` : '',
    actionContext ? `CONTEXTO DE AÇÃO JÁ CONFIRMADO:\n${JSON.stringify(actionContext).slice(0, 2400)}` : ''
  ].filter(Boolean).join('\n\n');
  const contents = history.slice(-12).map(item => ({
    role: item.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(item.content || '').slice(0, 8000) }]
  }));
  contents.push({ role: 'user', parts: [{ text: clean(message) }] });
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.geminiKey },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents }),
    signal: AbortSignal.timeout(route === 'reasoning' ? 22000 : 14000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`MODEL_ROUTER_${response.status}: ${data?.error?.message || 'generation failed'}`);
  const reply = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
  if (!reply) throw new Error('MODEL_ROUTER_EMPTY_RESPONSE');
  return reply;
}

export async function routedAnswer(input, fallbackAnswer) {
  const c = config();
  const status = modelRouterStatus();
  const routeName = classifyModelRoute(input.message, { actionContext: input.actionContext });
  const model = status.routes[routeName] || c.geminiModel;
  const metadata = { version: MODEL_ROUTER_VERSION, route: routeName, model, provider: status.provider };

  if (!status.enabled || !c.geminiKey || model === c.geminiModel) {
    return { reply: await fallbackAnswer(input), route: { ...metadata, execution: 'core' } };
  }
  try {
    const reply = await generateWithGemini({ ...input, model, route: routeName });
    return { reply, route: { ...metadata, execution: 'dedicated' } };
  } catch (error) {
    console.warn('[SEXTA Model Router] fallback:', error?.message || error);
    return { reply: await fallbackAnswer(input), route: { ...metadata, execution: 'fallback-core', error: String(error?.message || error).slice(0, 300) } };
  }
}
