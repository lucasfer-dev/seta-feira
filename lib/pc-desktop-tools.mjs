import * as legacy from './pc-desktop-tools-legacy.mjs';

const TARGETABLE_UI_TOOLS = new Set([
  'pc_ui_hotkey',
  'pc_ui_click_text',
  'pc_ui_type_text',
  'pc_ui_action',
  'pc_ui_scroll',
  'pc_screen_click'
]);

const UI_ACTIONS = [
  'invoke', 'click', 'double_click', 'right_click', 'focus',
  'select', 'add_to_selection', 'remove_from_selection', 'toggle',
  'expand', 'collapse', 'set_value', 'type', 'scroll_into_view',
  'set_range', 'increment', 'decrement'
];

function targetProperties(tool) {
  if (!TARGETABLE_UI_TOOLS.has(tool.name)) return tool.parameters;
  return {
    ...tool.parameters,
    properties: {
      ...(tool.parameters?.properties || {}),
      title: { type: 'string', description: 'Janela/processo alvo. Quando informado, a SEXTA restaura e confirma o foreground antes da ação.' },
      hwnd: { type: 'number', description: 'HWND exato retornado por pc_window_list. Prefira quando já conhecido.' }
    }
  };
}

function enrichDeclaration(tool) {
  const parameters = targetProperties(tool);

  if (tool.name === 'pc_ui_hotkey') {
    return {
      ...tool,
      description: 'Executa navegação/atalho seguro usando input nativo e aceita tanto atalho literal quanto intenção natural. Exemplos: “nova aba”→Ctrl+T, “fecha aba”→Ctrl+W, “reabre aba”→Ctrl+Shift+T, “próxima aba”→Ctrl+Tab, “aba anterior”→Ctrl+Shift+Tab, “nova janela”→Ctrl+N, “recarrega página”→Ctrl+R, “barra de endereço”→Ctrl+L, “volta/avança página”→Alt+Left/Right, “tela cheia”→F11, “encaixa esquerda/direita”→Win+Left/Right e mover para outro monitor→Win+Shift+Left/Right. Quando a ação pertence a um app específico, informe title/hwnd. Enter e Ctrl+V continuam bloqueados como atalhos genéricos.',
      parameters
    };
  }

  if (tool.name === 'pc_ui_action') {
    return {
      ...tool,
      description: 'Ação semântica profunda em um controle Windows. Localiza por Name/AutomationId/ControlType e escolhe UI Automation antes de mouse físico. Suporta invocar/clicar, clique duplo/direito, foco, seleção simples/múltipla, marcar/desmarcar via toggle, expandir/recolher menus e combos, preencher, trazer item para visão e controlar sliders/ranges por valor ou incremento. Use title/hwnd quando souber a janela. Senhas e controles finais sensíveis continuam bloqueados.',
      parameters: {
        ...parameters,
        properties: {
          ...(parameters?.properties || {}),
          action: {
            type: 'string',
            enum: UI_ACTIONS,
            description: 'Operação semântica. Para sliders use set_range/increment/decrement; para menus use invoke/expand/collapse; para contexto use right_click.'
          }
        }
      }
    };
  }

  if (tool.name === 'pc_ui_click_text') {
    return {
      ...tool,
      description: 'Aciona um controle pelo texto/nome. O backend prefere Invoke/ExpandCollapse/SelectionItem/Toggle e só cai para coordenadas quando necessário. Se um MenuItem expuser apenas SelectionItem e continuar visível após a seleção, a SEXTA reobserva a UI e faz um clique físico nativo no centro do item para realmente ativá-lo. Use title/hwnd para escolher a janela.',
      parameters
    };
  }

  if (tool.name === 'pc_ui_type_text') {
    return {
      ...tool,
      description: 'Preenche texto em campo editável da janela alvo. Prefere ValuePattern e usa teclado nativo quando necessário. O seletor favorece controles Edit/Value visíveis e não escreve em senha. Use title/hwnd para evitar digitar na janela errada.',
      parameters
    };
  }

  if (tool.name === 'pc_ui_scroll') {
    return {
      ...tool,
      description: 'Rola a janela/controle alvo. Prefere ScrollPattern do UI Automation; se o app não expuser rolagem semântica (canvas/Electron/custom UI), usa roda do mouse nativa como fallback e sinaliza que uma nova observação pode ser necessária.',
      parameters
    };
  }

  if (tool.name === 'pc_screen_click') {
    return {
      ...tool,
      description: 'Fallback de clique absoluto identificado por observação de tela. Use apenas quando DOM/UI Automation não expuser o alvo. Pode receber title/hwnd para focar a janela correta antes do clique; controles sensíveis continuam bloqueados.',
      parameters
    };
  }

  return { ...tool, parameters };
}

export const PC_DESKTOP_TOOL_DECLARATIONS = legacy.PC_DESKTOP_TOOL_DECLARATIONS.map(enrichDeclaration);

export function isPcDesktopTool(name) {
  return legacy.isPcDesktopTool(name);
}

function requestedTarget(args = {}) {
  const title = String(args.title || '').trim().slice(0, 240);
  const rawHwnd = Number(args.hwnd);
  const hwnd = Number.isSafeInteger(rawHwnd) && rawHwnd > 0 ? rawHwnd : 0;
  return { title, hwnd, hasTarget: Boolean(title || hwnd) };
}

function fold(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(value, terms) {
  return terms.some(term => value.includes(term));
}

function resolveHotkeyIntent(value = '') {
  const phrase = fold(value);
  if (containsAny(phrase, ['reabrir aba', 'reabre aba', 'reabra aba', 'reopen tab', 'restaurar aba fechada'])) return 'ctrl+shift+t';
  if (containsAny(phrase, ['fechar aba', 'fecha aba', 'feche aba', 'close tab', 'fechar guia', 'fecha guia'])) return 'ctrl+w';
  if (containsAny(phrase, ['nova aba', 'abrir aba', 'abre aba', 'new tab', 'nova guia', 'novo separador'])) return 'ctrl+t';
  if (containsAny(phrase, ['proxima aba', 'aba seguinte', 'next tab', 'proxima guia'])) return 'ctrl+tab';
  if (containsAny(phrase, ['aba anterior', 'previous tab', 'guia anterior'])) return 'ctrl+shift+tab';
  if (containsAny(phrase, ['nova janela', 'abrir janela do navegador', 'new window'])) return 'ctrl+n';
  if (containsAny(phrase, ['barra de endereco', 'barra de enderecos', 'address bar', 'focar endereco'])) return 'ctrl+l';
  if (containsAny(phrase, ['recarregar pagina', 'atualizar pagina', 'reload page', 'refresh page'])) return 'ctrl+r';
  if (containsAny(phrase, ['voltar pagina', 'pagina anterior', 'browser back'])) return 'alt+left';
  if (containsAny(phrase, ['avancar pagina', 'pagina seguinte', 'browser forward'])) return 'alt+right';
  if (containsAny(phrase, ['historico do navegador', 'browser history'])) return 'ctrl+h';
  if (containsAny(phrase, ['downloads do navegador', 'abrir downloads', 'browser downloads'])) return 'ctrl+j';
  if (containsAny(phrase, ['tela cheia', 'fullscreen'])) return 'f11';
  if (containsAny(phrase, ['encaixar esquerda', 'janela para esquerda', 'snap left'])) return 'win+left';
  if (containsAny(phrase, ['encaixar direita', 'janela para direita', 'snap right'])) return 'win+right';
  if (containsAny(phrase, ['monitor esquerdo', 'mover para monitor esquerdo', 'move to left monitor'])) return 'win+shift+left';
  if (containsAny(phrase, ['monitor direito', 'mover para monitor direito', 'move to right monitor'])) return 'win+shift+right';
  if (containsAny(phrase, ['gerenciador de tarefas', 'task manager'])) return 'ctrl+shift+esc';
  return String(value || '').trim().slice(0, 80);
}

async function focusTarget(target, name, args, options) {
  if (!target.hasTarget) return null;
  const focus = await legacy.executePcDesktopTool('pc_window_focus', {
    title: target.title,
    hwnd: target.hwnd
  }, options);

  if (!focus?.ok || focus?.state === 'failed') {
    return {
      ...focus,
      handled: true,
      scope: 'pc-hands',
      action: name.replace(/^pc_/, ''),
      requestedAction: name,
      actionSkipped: true,
      failureKind: 'target_focus_failed',
      requestedWindow: { title: target.title, hwnd: target.hwnd || null },
      message: 'A ação não foi enviada porque a janela alvo não pôde ser colocada em primeiro plano com verificação.'
    };
  }
  return focus;
}

function nativeResult(result) {
  return result?.state === 'completed' && result?.ok ? (result.result || {}) : null;
}

function menuDispatch(result, name, args = {}) {
  const native = nativeResult(result);
  if (!native || native.via !== 'SelectionItem' || native.requiresObservation !== true) return null;

  const controlType = String(native?.target?.controlType || native.controlType || '');
  if (!/MenuItem/i.test(controlType)) return null;

  if (name === 'pc_ui_click_text') {
    return {
      label: String(native?.target?.name || args.text || '').trim(),
      automationId: String(native?.target?.automationId || '').trim()
    };
  }

  const operation = String(args.action || '').toLowerCase();
  if (name === 'pc_ui_action' && (operation === 'click' || operation === 'invoke')) {
    return {
      label: String(native.name || args.name || '').trim(),
      automationId: String(native.automationId || args.automationId || '').trim()
    };
  }
  return null;
}

function findVisibleMenuNode(observation, dispatch) {
  const tree = nativeResult(observation);
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const label = fold(dispatch.label);
  const automationId = String(dispatch.automationId || '').trim().toLowerCase();

  return nodes.find(node => {
    if (!/MenuItem/i.test(String(node?.controlType || ''))) return false;
    if (node?.offscreen === true || node?.enabled === false) return false;
    const x = Number(node?.x), y = Number(node?.y), width = Number(node?.width), height = Number(node?.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 2 || height <= 2 || Math.abs(x) > 100000 || Math.abs(y) > 100000) return false;
    if (automationId && String(node?.automationId || '').trim().toLowerCase() === automationId) return true;
    return label && fold(node?.name) === label;
  }) || null;
}

async function stabilizeMenuActivation(name, args, result, options) {
  const dispatch = menuDispatch(result, name, args);
  if (!dispatch?.label && !dispatch?.automationId) return result;

  let observation;
  try {
    observation = await legacy.executePcDesktopTool('pc_ui_tree', { maxNodes: 180 }, options);
  } catch (error) {
    return {
      ...result,
      menuActivation: {
        semanticDispatched: true,
        postObservationAvailable: false,
        physicalFallbackUsed: false,
        error: String(error?.message || error).slice(0, 240)
      }
    };
  }

  const visible = findVisibleMenuNode(observation, dispatch);
  if (!visible) {
    return {
      ...result,
      result: {
        ...(result.result || {}),
        verified: true,
        verification: 'menu_item_no_longer_visible_after_semantic_dispatch'
      },
      menuActivation: {
        semanticDispatched: true,
        postObservationAvailable: true,
        itemStillVisible: false,
        physicalFallbackUsed: false
      }
    };
  }

  const x = Math.round(Number(visible.x) + Number(visible.width) / 2);
  const y = Math.round(Number(visible.y) + Number(visible.height) / 2);
  const label = String(visible.name || dispatch.label || 'menu item').slice(0, 240);
  const physical = await legacy.executePcDesktopTool('pc_screen_click', { x, y, label }, options);
  const physicalNative = nativeResult(physical);

  if (!physicalNative?.clicked) {
    return {
      ...result,
      ok: false,
      state: 'failed',
      error: physical?.error || 'PC_MENUITEM_ACTIVATION_NOT_VERIFIED',
      result: {
        ...(result.result || {}),
        verified: false,
        error: 'PC_MENUITEM_ACTIVATION_NOT_VERIFIED'
      },
      menuActivation: {
        semanticDispatched: true,
        postObservationAvailable: true,
        itemStillVisible: true,
        physicalFallbackUsed: true,
        physicalResult: physical
      }
    };
  }

  return {
    ...physical,
    action: result.action,
    commandId: physical.commandId,
    semanticCommandId: result.commandId,
    result: {
      ...physicalNative,
      verified: true,
      requiresObservation: true,
      via: 'native-menu-physical-fallback',
      semanticVia: 'SelectionItem'
    },
    menuActivation: {
      semanticDispatched: true,
      postObservationAvailable: true,
      itemStillVisible: true,
      physicalFallbackUsed: true,
      target: {
        name: visible.name,
        automationId: visible.automationId,
        controlType: visible.controlType,
        x,
        y
      }
    }
  };
}

export async function executePcDesktopTool(name, args = {}, options = {}) {
  if (!TARGETABLE_UI_TOOLS.has(name)) return legacy.executePcDesktopTool(name, args, options);

  const target = requestedTarget(args);
  const focus = await focusTarget(target, name, args, options);
  if (focus?.actionSkipped) return focus;

  const payload = { ...args };
  delete payload.title;
  delete payload.hwnd;
  if (name === 'pc_ui_hotkey') payload.shortcut = resolveHotkeyIntent(args.shortcut);

  const initial = await legacy.executePcDesktopTool(name, payload, options);
  const result = await stabilizeMenuActivation(name, payload, initial, options);
  return {
    ...result,
    ...(name === 'pc_ui_hotkey' ? {
      requestedShortcut: String(args.shortcut || '').slice(0, 80),
      resolvedShortcut: String(payload.shortcut || '').slice(0, 80)
    } : {}),
    ...(focus ? { targetFocus: focus, targetVerifiedBeforeAction: true } : {}),
    requestedWindow: target.hasTarget ? { title: target.title, hwnd: target.hwnd || null } : null
  };
}
