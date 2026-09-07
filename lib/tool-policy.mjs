const POLICY_VERSION = '1.0.1';

const WRITE_ACTIONS = new Set([
  'android_reply_notification',
  'google_send_email',
  'google_calendar_create',
  'google_docs_create',
  'google_sheets_create',
  'google_task_create',
  'whatsapp_send_message'
]);

const LOCAL_ACTIONS = new Set([
  'android_open_app',
  'android_open_settings',
  'android_set_volume',
  'android_adjust_volume',
  'android_flashlight',
  'android_media',
  'pc_open_app',
  'pc_open_project',
  'pc_open_url'
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
  'pc_codex_status',
  'memory_list'
]);

const EXPLICIT_ACTION_PATTERN = /\b(?:manda|mande|mandar|envia|envie|enviar|responde|responda|responder|cria|crie|criar|marca|marque|marcar|agenda|agende|agendar|adiciona|adicione|adicionar|salva|salve|salvar|abre|abra|abrir|liga|ligue|ligar|desliga|desligue|desligar|muda|mude|alterar|altera|altere|executa|execute|executar|roda|rode|rodar|faz|faça|fazer|corrige|corrija|corrigir|edita|edite|editar|implementa|implemente|implementar|send|reply|create|schedule|open|turn on|turn off|run|execute|edit|implement)\b/i;

const COMMUNICATION_PATTERN = /\b(?:email|e-mail|gmail|whatsapp|wpp|mensagem|message|reply|resposta)\b/i;
const CALENDAR_PATTERN = /\b(?:agenda|calend[aá]rio|evento|reuni[aã]o|compromisso|calendar|event|meeting)\b/i;
const DOCUMENT_PATTERN = /\b(?:documento|docs?|planilha|sheets?|tarefa|tasks?|document|spreadsheet)\b/i;
const CODE_PATTERN = /\b(?:codex|c[oó]digo|programa[cç][aã]o|projeto|repo|reposit[oó]rio|corrige|corrija|edita|edite|implementa|implemente|code|project|repository|repo|fix|edit|implement)\b/i;

function normalize(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function explicitForTool(name, userText = '') {
  const text = normalize(userText);
  if (!text || !EXPLICIT_ACTION_PATTERN.test(text)) return false;

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
