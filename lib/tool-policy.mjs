const POLICY_VERSION = '1.5.2';

const WRITE_ACTIONS = new Set([
  'android_reply_notification',
  'google_send_email',
  'google_calendar_create',
  'google_docs_create',
  'google_sheets_create',
  'google_task_create',
  'whatsapp_send_message',
  'pc_clipboard_write',
  'pc_ui_type_text',
  'pc_browser_type',
  'routine_save',
  'event_rule_save'
]);

const LOCAL_ACTIONS = new Set([
  'android_open_app',
  'android_open_settings',
  'android_set_volume',
  'android_adjust_volume',
  'android_flashlight',
  'android_media',
  'android_ui_tap_text',
  'android_ui_scroll',
  'android_ui_back',
  'android_ui_home',
  'pc_open_app',
  'pc_open_project',
  'pc_open_url',
  'pc_window_focus',
  'pc_window_close',
  'pc_window_state',
  'pc_window_move_resize',
  'pc_ui_click_text',
  'pc_ui_action',
  'pc_screen_click',
  'pc_ui_scroll',
  'pc_ui_hotkey',
  'pc_browser_open',
  'pc_browser_click',
  'pc_browser_select_tab',
  'pc_browser_back',
  'pc_browser_forward',
  'pc_browser_reload',
  'routine_run',
  'device_handoff'
]);

const READ_ACTIONS = new Set([
  'android_notifications',
  'android_device_info',
  'google_unread_email',
  'google_calendar_list',
  'google_drive_search',
  'google_contacts_search',
  'pc_git_status',
  'pc_system_info',
  'pc_hardware_status',
  'pc_codex_status',
  'memory_list',
  'memory_search',
  'memory_hygiene_status',
  'routine_list',
  'routine_match',
  'event_rule_list',
  'event_engine_run',
  'model_router_status'
]);

const PRIVATE_READ_ACTIONS = new Set([
  'android_ui_snapshot',
  'pc_clipboard_read',
  'pc_window_list',
  'pc_ui_tree',
  'pc_screen_analyze',
  'pc_browser_tabs',
  'pc_browser_snapshot'
]);

const EXPLICIT_ACTION_PATTERN = /\b(?:manda|mande|mandar|envia|envie|enviar|avisa|avise|avisar|monitora|monitore|monitorar|acompanha|acompanhe|acompanhar|lembra|lembre|lembrar|ensina|ensine|ensinar|continua|continue|continuar|transfere|transfira|transferir|responde|responda|responder|cria|crie|criar|marca|marque|marcar|agenda|agende|agendar|adiciona|adicione|adicionar|salva|salve|salvar|abre|abra|abrir|fecha|feche|fechar|traz|traga|trazer|minimiza|minimize|minimizar|maximiza|maximize|maximizar|restaura|restaure|restaurar|move|mova|mover|redimensiona|redimensione|redimensionar|liga|ligue|ligar|desliga|desligue|desligar|muda|mude|alterar|altera|altere|executa|execute|executar|roda|rode|rodar|faz|faça|fazer|resolve|resolva|corrige|corrija|corrigir|edita|edite|editar|implementa|implemente|implementar|procura|procure|procurar|pesquisa|pesquise|pesquisar|acha|ache|encontra|encontre|vai|ir|navega|navegue|navegar|seleciona|selecione|selecionar|toca|toque|tocar|clica|clique|clicar|rola|role|rolar|volta|volte|voltar|avanca|avance|avançar|recarrega|recarregue|atualiza|atualize|digita|digite|digitar|escreve|escreva|escrever|preenche|preencha|preencher|cola|cole|colar|coloca|coloque|colocar|send|reply|create|schedule|open|close|minimize|maximize|restore|bring|move|resize|turn on|turn off|run|execute|edit|implement|search|find|navigate|select|tap|click|scroll|back|forward|reload|type|fill|paste|put)\b/i;

const COMMUNICATION_PATTERN = /\b(?:email|e-mail|gmail|whatsapp|wpp|mensagem|message|reply|resposta)\b/i;
const CALENDAR_PATTERN = /\b(?:agenda|calend[aá]rio|evento|reuni[aã]o|compromisso|calendar|event|meeting)\b/i;
const DOCUMENT_PATTERN = /\b(?:documento|docs?|planilha|sheets?|tarefa|tasks?|document|spreadsheet)\b/i;
const CODE_PATTERN = /\b(?:codex|c[oó]digo|programa[cç][aã]o|projeto|repo|reposit[oó]rio|corrige|corrija|edita|edite|implementa|implemente|code|project|repository|repo|fix|edit|implement)\b/i;
const SCREEN_READ_PATTERN = /(?:\b(?:olha|olhe|ver|veja|vê|leia|ler|mostra|mostre|identifica|identifique|tela|screen|interface|janela|window|site|p[aá]gina|browser|navegador|abas?|tabs?)\b|o\s+que\s+(?:tem|aparece|esta|está))/i;
const CLIPBOARD_PATTERN = /(?:\b(?:clipboard|copiado|copiei|copiar|copia|copie|colar|cole)\b|[aá]rea\s+de\s+transfer[eê]ncia|ctrl\s*\+\s*[cv])/i;
const PC_PATTERN = /\b(?:pc|computador|windows|desktop|notebook|tela|navegador|browser|janela|programa|aplicativo|app)\b/i;

function normalize(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function explicitForTool(name, userText = '') {
  const text = normalize(userText);
  if (!text) return false;

  if (name === 'android_ui_snapshot' || ['pc_ui_tree', 'pc_screen_analyze', 'pc_window_list', 'pc_browser_tabs', 'pc_browser_snapshot'].includes(name)) {
    return SCREEN_READ_PATTERN.test(text) || EXPLICIT_ACTION_PATTERN.test(text);
  }
  if (name === 'pc_clipboard_read') return CLIPBOARD_PATTERN.test(text);
  if (name === 'pc_clipboard_write') return CLIPBOARD_PATTERN.test(text) && EXPLICIT_ACTION_PATTERN.test(text);
  if (name === 'pc_agent_task') return EXPLICIT_ACTION_PATTERN.test(text) && (PC_PATTERN.test(text) || SCREEN_READ_PATTERN.test(text));
  if (!EXPLICIT_ACTION_PATTERN.test(text)) return false;

  if (name === 'google_send_email' || name === 'whatsapp_send_message' || name === 'android_reply_notification') {
    return COMMUNICATION_PATTERN.test(text);
  }
  if (name === 'google_calendar_create') return CALENDAR_PATTERN.test(text);
  if (['google_docs_create', 'google_sheets_create', 'google_task_create'].includes(name)) return DOCUMENT_PATTERN.test(text);
  if (name === 'pc_codex_task') return CODE_PATTERN.test(text);
  return true;
}

export function getToolPolicy(name, args = {}, external = null) {
  if (external) {
    const annotations = external.annotations && typeof external.annotations === 'object' ? external.annotations : {};
    const readOnly = annotations.readOnlyHint === true;
    const destructive = annotations.destructiveHint === true;
    return {
      version: POLICY_VERSION,
      risk: destructive ? 'high' : readOnly ? 'low' : 'medium',
      sideEffect: readOnly ? 'read' : destructive ? 'destructive' : 'external-write',
      requiresExplicit: !readOnly,
      destructive,
      external: true
    };
  }

  if (name === 'pc_codex_task') {
    const edit = args?.mode === 'edit';
    return {
      version: POLICY_VERSION,
      risk: edit ? 'high' : 'medium',
      sideEffect: edit ? 'code-write' : 'analysis',
      requiresExplicit: true,
      destructive: false,
      external: false
    };
  }

  if (name === 'pc_agent_task') {
    return {
      version: POLICY_VERSION,
      risk: 'high',
      sideEffect: 'autonomous-local-action',
      requiresExplicit: true,
      destructive: false,
      external: false
    };
  }

  if (name === 'pc_ui_action' && ['set_value', 'type'].includes(String(args?.action || ''))) {
    return { version: POLICY_VERSION, risk: 'high', sideEffect: 'write', requiresExplicit: true, destructive: false, external: false };
  }

  if (name === 'routine_run') return { version: POLICY_VERSION, risk: 'medium', sideEffect: 'routine-execution', requiresExplicit: true, destructive: false, external: false };
  if (name === 'device_handoff') return { version: POLICY_VERSION, risk: 'medium', sideEffect: 'device-handoff', requiresExplicit: true, destructive: false, external: false };
  if (name === 'event_engine_run') return { version: POLICY_VERSION, risk: 'low', sideEffect: 'internal-notification-check', requiresExplicit: false, destructive: false, external: false };

  if (PRIVATE_READ_ACTIONS.has(name)) {
    return {
      version: POLICY_VERSION,
      risk: 'low',
      sideEffect: name.includes('screen') || name.includes('ui_') || name.includes('browser') ? 'screen-read' : 'private-read',
      requiresExplicit: true,
      destructive: false,
      external: false
    };
  }

  if (WRITE_ACTIONS.has(name)) return { version: POLICY_VERSION, risk: 'high', sideEffect: 'write', requiresExplicit: true, destructive: false, external: false };
  if (LOCAL_ACTIONS.has(name)) return { version: POLICY_VERSION, risk: 'medium', sideEffect: 'local-action', requiresExplicit: true, destructive: false, external: false };
  if (READ_ACTIONS.has(name)) return { version: POLICY_VERSION, risk: 'low', sideEffect: 'read', requiresExplicit: false, destructive: false, external: false };
  return { version: POLICY_VERSION, risk: 'medium', sideEffect: 'unknown', requiresExplicit: false, destructive: false, external: false };
}

export function evaluateToolPolicy(name, args = {}, context = {}) {
  const policy = getToolPolicy(name, args, context.externalTool || null);
  const enforceExplicit = context.enforceExplicit === true;
  const userText = normalize(context.userText || '');

  if (policy.external && policy.destructive && process.env.SEXTA_MCP_ALLOW_DESTRUCTIVE !== 'true') {
    return { ...policy, allowed: false, reason: 'MCP_DESTRUCTIVE_TOOL_DISABLED' };
  }

  if (enforceExplicit && policy.requiresExplicit && !explicitForTool(name, userText)) {
    return { ...policy, allowed: false, reason: 'EXPLICIT_USER_ACTION_REQUIRED' };
  }

  return { ...policy, allowed: true, reason: 'allowed' };
}

export function toolPolicyVersion() {
  return POLICY_VERSION;
}
