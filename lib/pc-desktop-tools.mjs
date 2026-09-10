import * as legacy from './pc-desktop-tools-legacy.mjs';

export const PC_DESKTOP_TOOL_DECLARATIONS = legacy.PC_DESKTOP_TOOL_DECLARATIONS.map(tool => {
  if (tool.name !== 'pc_ui_hotkey') return tool;
  return {
    ...tool,
    description: 'Executa um atalho de teclado seguro no Windows usando input nativo. Quando o comando se refere a um aplicativo específico, informe title e/ou hwnd: a SEXTA restaura/foca essa janela e verifica o foreground antes de enviar o atalho. Enter e Ctrl+V continuam fora da automação genérica.',
    parameters: {
      ...tool.parameters,
      properties: {
        ...(tool.parameters?.properties || {}),
        title: { type: 'string', description: 'Título ou nome do processo alvo. Opcional; use quando o atalho deve ir para um aplicativo específico.' },
        hwnd: { type: 'number', description: 'HWND exato retornado por pc_window_list. Opcional e preferível quando já conhecido.' }
      }
    }
  };
});

export function isPcDesktopTool(name) {
  return legacy.isPcDesktopTool(name);
}

function requestedTarget(args = {}) {
  const title = String(args.title || '').trim().slice(0, 240);
  const rawHwnd = Number(args.hwnd);
  const hwnd = Number.isSafeInteger(rawHwnd) && rawHwnd > 0 ? rawHwnd : 0;
  return { title, hwnd, hasTarget: Boolean(title || hwnd) };
}

export async function executePcDesktopTool(name, args = {}, options = {}) {
  if (name !== 'pc_ui_hotkey') return legacy.executePcDesktopTool(name, args, options);

  const target = requestedTarget(args);
  let focus = null;
  if (target.hasTarget) {
    focus = await legacy.executePcDesktopTool('pc_window_focus', {
      title: target.title,
      hwnd: target.hwnd
    }, options);

    if (!focus?.ok || focus?.state === 'failed') {
      return {
        ...focus,
        handled: true,
        scope: 'pc-hands',
        action: 'ui_hotkey',
        requestedShortcut: String(args.shortcut || '').slice(0, 80),
        hotkeySkipped: true,
        failureKind: 'target_focus_failed',
        message: 'O atalho não foi enviado porque a janela alvo não pôde ser colocada em primeiro plano com verificação.'
      };
    }
  }

  const hotkey = await legacy.executePcDesktopTool('pc_ui_hotkey', {
    shortcut: String(args.shortcut || '').slice(0, 80)
  }, options);

  return {
    ...hotkey,
    ...(focus ? { targetFocus: focus, targetVerifiedBeforeHotkey: true } : {}),
    requestedWindow: target.hasTarget ? { title: target.title, hwnd: target.hwnd || null } : null
  };
}
