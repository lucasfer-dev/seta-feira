import { getCommand, getDevices, queueCommand } from './core.mjs';
import { encodeDesktopCommand, isDesktopProtocolAction } from './pc-command-protocol.mjs';

const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const stringProp = description => ({ type: 'string', description });
const numberProp = description => ({ type: 'number', description });
const recentScreenAnalyses = new Map();
const SCREEN_DEDUPE_MS = 6_000;

export const PC_DESKTOP_TOOL_DECLARATIONS = [
  { name: 'pc_clipboard_read', description: 'Lê o texto atualmente copiado no clipboard do Windows conectado. Use somente quando o usuário pedir para ler/usar o que está copiado.', parameters: objectSchema({}) },
  { name: 'pc_clipboard_write', description: 'Coloca um texto no clipboard do Windows conectado. Não cola nem envia automaticamente.', parameters: objectSchema({ text: stringProp('Texto para colocar no clipboard, até 20 mil caracteres.') }, ['text']) },
  { name: 'pc_window_list', description: 'Lista as janelas visíveis do Windows para descobrir quais aplicativos estão abertos.', parameters: objectSchema({ limit: numberProp('Máximo de janelas, entre 1 e 30.') }) },
  { name: 'pc_window_focus', description: 'Traz para frente uma janela visível do Windows pelo título. Não executa ações dentro dela.', parameters: objectSchema({ title: stringProp('Parte distintiva do título da janela.') }, ['title']) },
  { name: 'pc_ui_tree', description: 'Observa sob demanda a interface da janela ativa usando Windows UI Automation. Retorna controles estruturados, sem captura contínua de tela e sem campos de senha.', parameters: objectSchema({ maxNodes: numberProp('Máximo de controles, entre 20 e 180.') }) },
  { name: 'pc_screen_analyze', description: 'Olha a tela do PC uma única vez usando captura local + visão multimodal. Se a visão do provedor ficar temporariamente indisponível, a SEXTA deve usar UI Automation/DOM automaticamente em vez de pedir novamente permissão de tela. Quando esta ferramenta executa, a autorização local já foi concedida no PC Agent.', parameters: objectSchema({ question: stringProp('O que deve ser observado na tela.'), scope: { type: 'string', enum: ['primary', 'all'], description: 'primary captura monitor principal; all captura a área virtual de monitores.' } }, ['question']) },
  { name: 'pc_ui_click_text', description: 'Clica semanticamente em um controle da janela ativa pelo texto/nome usando UI Automation. Controles finais sensíveis como pagar, comprar, enviar, excluir ou confirmar são bloqueados nativamente.', parameters: objectSchema({ text: stringProp('Texto visível ou nome do controle a acionar.') }, ['text']) },
  { name: 'pc_ui_type_text', description: 'Preenche um campo de texto da janela ativa usando UI Automation. Nunca escreve em campo marcado como senha. Use apenas quando o usuário pediu explicitamente para digitar/preencher.', parameters: objectSchema({ text: stringProp('Texto a inserir.'), target: stringProp('Nome/label do campo; vazio usa o campo de edição focado.') }, ['text']) },
  { name: 'pc_ui_scroll', description: 'Rola semanticamente a janela/controle ativo para cima ou para baixo usando UI Automation.', parameters: objectSchema({ direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'string', enum: ['small', 'large'] } }, ['direction']) },
  { name: 'pc_ui_hotkey', description: 'Executa um atalho de teclado limitado a uma allowlist segura no Windows, como Ctrl+F, Ctrl+L, Ctrl+C, Ctrl+Tab, Alt+Left ou Escape. Enter e Ctrl+V não são liberados na automação genérica.', parameters: objectSchema({ shortcut: stringProp('Atalho permitido em formato natural, por exemplo ctrl+f ou esc.') }, ['shortcut']) },
  { name: 'pc_hardware_status', description: 'Lê telemetria local estruturada do PC conectado: CPU, memória, discos, GPU, bateria e rede. Não lê arquivos nem conteúdo de tela.', parameters: objectSchema({}) },
  { name: 'pc_browser_open', description: 'Abre/navega uma página na aba selecionada do Browser Agent dedicado da SEXTA usando Chrome/Edge DevTools Protocol.', parameters: objectSchema({ url: stringProp('URL http/https.') }, ['url']) },
  { name: 'pc_browser_tabs', description: 'Lista abas abertas no Browser Agent dedicado e indica qual aba está selecionada para automação.', parameters: objectSchema({}) },
  { name: 'pc_browser_select_tab', description: 'Seleciona uma aba do Browser Agent pelo índice retornado em pc_browser_tabs.', parameters: objectSchema({ index: numberProp('Índice da aba retornada por pc_browser_tabs.') }, ['index']) },
  { name: 'pc_browser_snapshot', description: 'Lê o DOM visível da aba selecionada do Browser Agent e retorna título, URL, texto e elementos interativos numerados. Prefira isto a visão por pixels em sites.', parameters: objectSchema({}) },
  { name: 'pc_browser_click', description: 'Clica em um elemento interativo numerado do estado atual do Browser Agent. Alvos sensíveis como pagar, comprar, enviar, excluir, publicar ou confirmar são bloqueados.', parameters: objectSchema({ index: numberProp('Índice do elemento retornado por pc_browser_snapshot.') }, ['index']) },
  { name: 'pc_browser_type', description: 'Preenche um elemento de formulário numerado do Browser Agent sem submeter automaticamente. Campos de senha são bloqueados.', parameters: objectSchema({ index: numberProp('Índice do campo retornado por pc_browser_snapshot.'), text: stringProp('Texto a inserir.') }, ['index', 'text']) },
  { name: 'pc_browser_back', description: 'Volta uma página na aba selecionada do Browser Agent.', parameters: objectSchema({}) },
  { name: 'pc_browser_forward', description: 'Avança uma página na aba selecionada do Browser Agent.', parameters: objectSchema({}) },
  { name: 'pc_browser_reload', description: 'Recarrega a aba selecionada do Browser Agent sem limpar cache.', parameters: objectSchema({}) },
  { name: 'pc_agent_task', description: 'Executa uma tarefa multi-etapas no PC usando o ciclo observar → agir → verificar. Requer que o PC esteja no modo de autonomia Autônomo. Prefere DOM no navegador, UI Automation no desktop e visão por screenshot apenas como fallback.', parameters: objectSchema({ goal: stringProp('Objetivo explícito pedido pelo usuário para o PC.'), maxSteps: numberProp('Máximo de passos, de 2 a 10.') }, ['goal']) }
];

const NAMES = new Set(PC_DESKTOP_TOOL_DECLARATIONS.map(tool => tool.name));
export function isPcDesktopTool(name) { return NAMES.has(String(name || '')); }

function isPcExecutor(device = {}) {
  const caps = new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
  const context = device.context && typeof device.context === 'object' ? device.context : {};
  return Boolean(device.online && (String(device.kind || '').toLowerCase() === 'agent' || context.pcAgent === true || caps.has('ui_tree') || caps.has('browser_snapshot') || caps.has('get_system_info')));
}

async function onlinePc() {
  const devices = await getDevices();
  return devices.find(isPcExecutor) || null;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForCommand(commandId, timeoutMs = 12000) {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  while (Date.now() < deadline) {
    const command = await getCommand(commandId);
    if (!command) throw new Error('PC_COMMAND_NOT_FOUND');
    if (command.status === 'done') return { state: 'completed', ok: true, result: command.result || {} };
    if (command.status === 'failed') {
      const result = command.result || {};
      return { state: 'failed', ok: false, result, error: result.error || result.message || 'PC_ACTION_FAILED' };
    }
    await sleep(240);
  }
  return { state: 'accepted', ok: true, queued: true, commandId };
}

function commandFor(name, args = {}) {
  switch (name) {
    case 'pc_clipboard_read': return ['read_clipboard', {}];
    case 'pc_clipboard_write': return ['copy_text', { text: String(args.text || '').slice(0, 20000) }];
    case 'pc_window_list': return ['window_list', { limit: Math.max(1, Math.min(30, Number(args.limit) || 12)) }];
    case 'pc_window_focus': return ['window_focus', { title: String(args.title || '').slice(0, 240) }];
    case 'pc_ui_tree': return ['ui_tree', { maxNodes: Math.max(20, Math.min(180, Number(args.maxNodes) || 120)) }];
    case 'pc_screen_analyze': return ['screen_analyze', { question: String(args.question || '').slice(0, 1600), scope: args.scope === 'all' ? 'all' : 'primary' }];
    case 'pc_ui_click_text': return ['ui_click_text', { text: String(args.text || '').slice(0, 240) }];
    case 'pc_ui_type_text': return ['ui_type_text', { text: String(args.text || '').slice(0, 4000), target: String(args.target || '').slice(0, 240) }];
    case 'pc_ui_scroll': return ['ui_scroll', { direction: args.direction === 'up' ? 'up' : 'down', amount: args.amount === 'small' ? 'small' : 'large' }];
    case 'pc_ui_hotkey': return ['ui_hotkey', { shortcut: String(args.shortcut || '').slice(0, 80) }];
    case 'pc_hardware_status': return ['hardware_status', {}];
    case 'pc_browser_open': return ['browser_open', { url: String(args.url || '').slice(0, 2000) }];
    case 'pc_browser_tabs': return ['browser_tabs', {}];
    case 'pc_browser_select_tab': return ['browser_select_tab', { index: Math.max(0, Math.floor(Number(args.index) || 0)) }];
    case 'pc_browser_snapshot': return ['browser_snapshot', {}];
    case 'pc_browser_click': return ['browser_click', { index: Math.max(0, Math.floor(Number(args.index) || 0)) }];
    case 'pc_browser_type': return ['browser_type', { index: Math.max(0, Math.floor(Number(args.index) || 0)), text: String(args.text || '').slice(0, 4000) }];
    case 'pc_browser_back': return ['browser_back', {}];
    case 'pc_browser_forward': return ['browser_forward', {}];
    case 'pc_browser_reload': return ['browser_reload', {}];
    default: return null;
  }
}

function screenCacheKey(deviceId, payload = {}) {
  const question = String(payload.question || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${deviceId}|${payload.scope === 'all' ? 'all' : 'primary'}|${question}`;
}
function pruneScreenCache(now = Date.now()) {
  for (const [key, entry] of recentScreenAnalyses) {
    if (!entry || now - entry.at > SCREEN_DEDUPE_MS) recentScreenAnalyses.delete(key);
  }
}

function visionProviderUnavailable(final = {}) {
  const text = String(final?.error || final?.result?.error || final?.result?.message || '');
  return /vision_temporarily_unavailable|pc-vision-analyze:\s*503|operation was aborted due to timeout|provider.*timeout/i.test(text);
}

function localPermissionState(pc = {}) {
  const privacy = pc?.context?.privacy && typeof pc.context.privacy === 'object' ? pc.context.privacy : {};
  return {
    screen: privacy.screen === true,
    uiAutomation: privacy.uiAutomation === true,
    browser: privacy.browser === true,
    persistentGrant: privacy.screen === true
  };
}

async function uiTreeFallback(pc) {
  const payload = { maxNodes: 140, _sextaVisionFallback: true };
  const transport = isDesktopProtocolAction('ui_tree') ? encodeDesktopCommand('ui_tree', payload) : { action: 'ui_tree', payload };
  const command = await queueCommand(pc.device_id, transport.action, transport.payload);
  const final = await waitForCommand(command.id, 8000);
  return { command, final };
}

export async function executePcDesktopTool(name, args = {}, options = {}) {
  if (name === 'pc_agent_task') throw new Error('PC_AGENT_TASK_REQUIRES_TOOL_CORE');
  const mapped = commandFor(name, args);
  if (!mapped) throw new Error('PC_DESKTOP_TOOL_NOT_ALLOWED');
  const pc = await onlinePc();
  if (!pc) throw new Error('NO_PC_AGENT_ONLINE');
  const [action, basePayload] = mapped;

  if (action === 'screen_analyze') {
    pruneScreenCache();
    const key = screenCacheKey(pc.device_id, basePayload);
    const cached = recentScreenAnalyses.get(key);
    if (cached && Date.now() - cached.at <= SCREEN_DEDUPE_MS) {
      return { ...cached.value, deduped: true };
    }
  }

  const payload = options.agentInternal === true ? { ...basePayload, _sextaAgentTask: true } : basePayload;
  const transport = isDesktopProtocolAction(action) ? encodeDesktopCommand(action, payload) : { action, payload };
  const command = await queueCommand(pc.device_id, transport.action, transport.payload);
  const timeout = action === 'screen_analyze' ? 18000 : 9000;
  const final = await waitForCommand(command.id, timeout);
  const permission = localPermissionState(pc);

  if (action === 'screen_analyze' && !final.ok && visionProviderUnavailable(final)) {
    if (permission.uiAutomation) {
      try {
        const fallback = await uiTreeFallback(pc);
        if (fallback.final.ok && fallback.final.state === 'completed') {
          return {
            ...fallback.final,
            handled: true,
            scope: 'pc-hands',
            commandId: fallback.command.id,
            target: pc.name,
            action: 'ui_tree',
            requestedAction: 'screen_analyze',
            fallback: 'ui_tree',
            visualProviderUnavailable: true,
            permissionGranted: true,
            permission,
            message: 'A permissão de tela já está concedida. A visão por pixels ficou temporariamente indisponível, então a SEXTA observou a interface usando Windows UI Automation. Não peça nova confirmação de permissão.'
          };
        }
      } catch (error) {
        console.warn('[SEXTA PC Vision] UI Automation fallback falhou:', error?.message || error);
      }
    }

    return {
      ...final,
      handled: true,
      scope: 'pc-hands',
      commandId: command.id,
      target: pc.name,
      action,
      visualProviderUnavailable: true,
      permissionGranted: permission.screen,
      permission,
      failureKind: 'vision_provider_timeout',
      message: permission.screen
        ? 'A permissão de tela já está concedida no PC Agent. A falha atual é temporária no provedor de visão; não peça nova confirmação de permissão.'
        : 'A captura de tela não está habilitada no PC Agent.'
    };
  }

  const value = {
    ...final,
    handled: true,
    scope: action.startsWith('browser_') ? 'pc-browser' : action.startsWith('ui_') || action.startsWith('screen_') ? 'pc-hands' : 'pc',
    commandId: command.id,
    target: pc.name,
    action,
    ...(action === 'screen_analyze' ? { permissionGranted: permission.screen, permission } : {})
  };
  if (action === 'screen_analyze' && final.ok && final.state === 'completed') {
    recentScreenAnalyses.set(screenCacheKey(pc.device_id, basePayload), { at: Date.now(), value });
  }
  return value;
}
