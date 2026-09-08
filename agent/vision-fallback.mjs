import { uiTree, windowList } from './windows-ui.mjs';

const nativeFetch = globalThis.fetch?.bind(globalThis);
const VISION_PATH = '/api/pc-vision-analyze';
const LOCAL_VISION_DEADLINE_MS = 4200;

function isVisionRequest(input) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
  if (!raw) return false;
  try { return new URL(raw, 'https://sexta.local').pathname === VISION_PATH; }
  catch { return raw.includes(VISION_PATH); }
}

function requestPayload(init = {}) {
  if (typeof init?.body !== 'string') return {};
  try { return JSON.parse(init.body); } catch { return {}; }
}

function questionNeedsPixelVision(question = '', scope = 'primary') {
  if (scope === 'all') return true;
  const text = String(question || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(?:cor|cores|imagem|foto|icone|aparencia|visual|layout|grafico|desenho|pixel|screenshot|captura|posicao|coordenada|esquerda|direita|acima|abaixo|video|jogo|rosto|pessoa|objeto)\b/i.test(text);
}

function flattenTree(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const candidates = Array.isArray(tree.nodes) ? tree.nodes : Array.isArray(tree.controls) ? tree.controls : Array.isArray(tree.items) ? tree.items : [];
  return candidates.slice(0, 100).map(item => {
    if (typeof item === 'string') return item;
    const name = String(item?.name || item?.title || item?.text || item?.label || '').trim();
    const type = String(item?.controlType || item?.type || item?.role || '').replace(/^ControlType\./, '').trim();
    return [type, name].filter(Boolean).join(': ');
  }).filter(Boolean);
}

function semanticTargets(tree) {
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  return nodes
    .filter(item => item && typeof item === 'object' && !item.password && String(item.name || '').trim())
    .slice(0, 20)
    .map(item => ({
      label: String(item.name || '').slice(0, 180),
      kind: String(item.controlType || '').replace(/^ControlType\./, '').slice(0, 80),
      locationHint: Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))
        ? `${Math.round(Number(item.x))},${Math.round(Number(item.y))}`
        : ''
    }));
}

function uniqueText(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

async function localSemanticFallback(reason = '', { semanticFirst = false } = {}) {
  const [tree, windowsResult] = await Promise.all([
    uiTree(140),
    windowList(12).catch(() => ({ windows: [], count: 0 }))
  ]);
  const windows = Array.isArray(windowsResult?.windows) ? windowsResult.windows : [];
  const windowTitles = windows.map(item => item?.title).filter(Boolean);
  const visibleText = uniqueText([...windowTitles, ...flattenTree(tree)]).slice(0, 24);
  const activeApp = String(tree?.window || windowTitles[0] || '').trim();
  const prefix = semanticFirst
    ? 'A interface foi observada localmente por Windows UI Automation, sem esperar visão por pixels.'
    : 'A visão por pixels ficou indisponível ou lenta; a interface foi observada localmente por Windows UI Automation.';

  return {
    ok: true,
    model: semanticFirst ? 'local-ui-automation-first' : 'local-ui-automation-fallback',
    fallbackUsed: !semanticFirst,
    compatibilityMode: false,
    permissionIssue: false,
    localFallback: 'ui_tree',
    semanticFirst,
    analysis: {
      summary: visibleText.length
        ? `${prefix} Janela ativa: ${activeApp || 'não identificada'}. Conteúdo: ${visibleText.slice(0, 10).join(' | ')}`
        : `${prefix} Não encontrei texto semântico suficiente na janela ativa.`,
      activeApp,
      visibleText,
      targets: semanticTargets(tree),
      risks: semanticFirst ? ['semantic_ui_observation'] : ['visual_provider_unavailable', 'semantic_ui_fallback'],
      semanticTree: tree,
      openWindows: windows,
      providerError: String(reason || '').slice(0, 500)
    },
    message: 'A permissão local já está concedida. Use esta observação normalmente e não solicite nova confirmação de permissão.'
  };
}

function responseFrom(payload, mode = 'ui-tree') {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-SEXTA-Vision-Fallback': mode
    }
  });
}

function boundedVisionInit(init = {}) {
  if (typeof AbortSignal?.timeout !== 'function') return init;
  const deadline = AbortSignal.timeout(LOCAL_VISION_DEADLINE_MS);
  const original = init?.signal;
  const signal = original && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([original, deadline])
    : deadline;
  return { ...init, signal };
}

if (typeof nativeFetch === 'function' && !globalThis.__sextaVisionLocalFallbackInstalled) {
  globalThis.__sextaVisionLocalFallbackInstalled = true;
  globalThis.fetch = async (input, init) => {
    if (!isVisionRequest(input)) return nativeFetch(input, init);

    const payload = requestPayload(init);
    const question = String(payload.question || '');
    const scope = payload.scope === 'all' ? 'all' : 'primary';

    // A maioria dos pedidos "olha minha tela / o que está aberto / qual botão está
    // aí" é semântica. Responder localmente evita 15–25 s de ida ao provider.
    if (!questionNeedsPixelVision(question, scope)) {
      try {
        const semantic = await localSemanticFallback('semantic-first', { semanticFirst: true });
        const useful = Boolean(semantic.analysis?.activeApp) || (semantic.analysis?.visibleText?.length || 0) >= 2;
        if (useful) return responseFrom(semantic, 'ui-tree-first');
      } catch {}
    }

    try {
      const response = await nativeFetch(input, boundedVisionInit(init));
      if (response.ok || ![502, 503, 504].includes(Number(response.status))) return response;
      const text = await response.clone().text().catch(() => '');
      const fallback = await localSemanticFallback(`HTTP ${response.status}: ${text}`);
      return responseFrom(fallback);
    } catch (error) {
      const message = String(error?.message || error || 'vision request failed');
      if (!/timeout|abort|fetch|network|signal/i.test(message)) throw error;
      const fallback = await localSemanticFallback(`${message}; localDeadlineMs=${LOCAL_VISION_DEADLINE_MS}`);
      return responseFrom(fallback, 'ui-tree-deadline');
    }
  };
}

export const VISION_LOCAL_FALLBACK_VERSION = '1.1.0-semantic-first';
