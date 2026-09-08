import { uiTree } from './windows-ui.mjs';

const nativeFetch = globalThis.fetch?.bind(globalThis);
const VISION_PATH = '/api/pc-vision-analyze';

function isVisionRequest(input) {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
  if (!raw) return false;
  try { return new URL(raw, 'https://sexta.local').pathname === VISION_PATH; }
  catch { return raw.includes(VISION_PATH); }
}

function flattenTree(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const candidates = Array.isArray(tree.nodes) ? tree.nodes : Array.isArray(tree.controls) ? tree.controls : Array.isArray(tree.items) ? tree.items : [];
  return candidates.slice(0, 80).map(item => {
    if (typeof item === 'string') return item;
    const name = String(item?.name || item?.title || item?.text || item?.label || '').trim();
    const type = String(item?.controlType || item?.type || item?.role || '').trim();
    return [type, name].filter(Boolean).join(': ');
  }).filter(Boolean);
}

async function localSemanticFallback(reason = '') {
  const tree = await uiTree(140);
  const visibleText = flattenTree(tree).slice(0, 20);
  return {
    ok: true,
    model: 'local-ui-automation-fallback',
    fallbackUsed: true,
    compatibilityMode: false,
    permissionIssue: false,
    localFallback: 'ui_tree',
    analysis: {
      summary: visibleText.length
        ? `A visão por pixels ficou temporariamente indisponível. A interface foi observada localmente por UI Automation: ${visibleText.slice(0, 8).join(' | ')}`
        : 'A visão por pixels ficou temporariamente indisponível. A SEXTA confirmou acesso local à interface via UI Automation, mas não encontrou texto semântico suficiente.',
      activeApp: '',
      visibleText,
      targets: [],
      risks: ['visual_provider_unavailable', 'semantic_ui_fallback'],
      semanticTree: tree,
      providerError: String(reason || '').slice(0, 500)
    },
    message: 'A permissão local já está concedida. O fallback de UI Automation foi usado automaticamente; não solicite nova confirmação de permissão.'
  };
}

if (typeof nativeFetch === 'function' && !globalThis.__sextaVisionLocalFallbackInstalled) {
  globalThis.__sextaVisionLocalFallbackInstalled = true;
  globalThis.fetch = async (input, init) => {
    if (!isVisionRequest(input)) return nativeFetch(input, init);

    try {
      const response = await nativeFetch(input, init);
      if (response.ok || ![502, 503, 504].includes(Number(response.status))) return response;
      const text = await response.clone().text().catch(() => '');
      const fallback = await localSemanticFallback(`HTTP ${response.status}: ${text}`);
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-SEXTA-Vision-Fallback': 'ui-tree' }
      });
    } catch (error) {
      const message = String(error?.message || error || 'vision request failed');
      if (!/timeout|abort|fetch|network/i.test(message)) throw error;
      const fallback = await localSemanticFallback(message);
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-SEXTA-Vision-Fallback': 'ui-tree' }
      });
    }
  };
}

export const VISION_LOCAL_FALLBACK_VERSION = '1.0.0';
