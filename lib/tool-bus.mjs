import { config, getCommand, getDevices, getMemories, queueCommand } from './core.mjs';
import { queueAndroidAction } from './android-actions.mjs';
import { executeWorkspaceAction, googleStatus } from './google.mjs';
import { evolutionStatus, sendWhatsAppText } from './evolution.mjs';

const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const stringProp = (description) => ({ type: 'string', description });
const numberProp = (description) => ({ type: 'number', description });
const boolProp = (description) => ({ type: 'boolean', description });

export const LIVE_TOOL_DECLARATIONS = [
  { name: 'android_open_app', description: 'Abre um aplicativo no celular Android atual. Se a sessão estiver rodando no Android, prefira esta ferramenta para abrir apps; não use pc_open_app a menos que o usuário peça explicitamente o PC.', parameters: objectSchema({ app: stringProp('Nome natural do aplicativo, por exemplo whatsapp, spotify, youtube, gmail, camera.') }, ['app']) },
  { name: 'android_open_settings', description: 'Abre configurações do Android, opcionalmente em uma seção como wifi, bluetooth, notificações ou acessibilidade.', parameters: objectSchema({ section: stringProp('Seção desejada; vazio abre Configurações gerais.') }) },
  { name: 'android_set_volume', description: 'Define o volume de mídia do Android em uma porcentagem de 0 a 100.', parameters: objectSchema({ percent: numberProp('Percentual de volume entre 0 e 100.') }, ['percent']) },
  { name: 'android_adjust_volume', description: 'Aumenta ou diminui um passo do volume de mídia do Android.', parameters: objectSchema({ direction: { type: 'string', enum: ['up', 'down'], description: 'up aumenta, down diminui.' } }, ['direction']) },
  { name: 'android_flashlight', description: 'Liga ou desliga a lanterna do Android.', parameters: objectSchema({ enabled: boolProp('true para ligar, false para desligar.') }, ['enabled']) },
  { name: 'android_media', description: 'Controla a mídia tocando no Android: play_pause, next ou previous.', parameters: objectSchema({ command: { type: 'string', enum: ['play_pause', 'next', 'previous'] } }, ['command']) },
  { name: 'android_notifications', description: 'Lista notificações recentes do Android, podendo filtrar por aplicativo como whatsapp.', parameters: objectSchema({ app: stringProp('Aplicativo opcional para filtrar.'), limit: numberProp('Quantidade máxima, entre 1 e 20.') }) },
  { name: 'android_reply_notification', description: 'Responde uma notificação que oferece resposta rápida, como uma conversa do WhatsApp. Use somente quando o usuário pediu explicitamente para responder/enviar a mensagem.', parameters: objectSchema({ app: stringProp('Aplicativo, normalmente whatsapp.'), recipient: stringProp('Nome do destinatário quando informado.'), text: stringProp('Texto a responder.') }, ['text']) },
  { name: 'android_device_info', description: 'Consulta informações básicas do celular Android conectado.', parameters: objectSchema({}) },
  { name: 'google_send_email', description: 'Envia um e-mail pela conta Google autorizada do usuário. Use apenas quando o usuário pedir para enviar.', parameters: objectSchema({ recipient: stringProp('E-mail ou nome do contato.'), subject: stringProp('Assunto do e-mail.'), body: stringProp('Corpo do e-mail.') }, ['recipient', 'body']) },
  { name: 'google_unread_email', description: 'Lê a lista resumida de e-mails não lidos recentes da conta Gmail autorizada.', parameters: objectSchema({ maxResults: numberProp('Quantidade máxima entre 1 e 10.') }) },
  { name: 'google_calendar_list', description: 'Lista os eventos da agenda Google do usuário para hoje ou amanhã.', parameters: objectSchema({ day: { type: 'string', enum: ['today', 'tomorrow'] } }) },
  { name: 'google_calendar_create', description: 'Cria um evento na agenda Google. Para evento de dia inteiro use date YYYY-MM-DD. Para horário específico use startDateTime e endDateTime em ISO 8601.', parameters: objectSchema({ title: stringProp('Título do evento.'), date: stringProp('Data YYYY-MM-DD para dia inteiro.'), startDateTime: stringProp('Início ISO 8601 com horário.'), endDateTime: stringProp('Fim ISO 8601 com horário.'), description: stringProp('Descrição opcional.') }, ['title']) },
  { name: 'google_drive_search', description: 'Pesquisa arquivos e documentos no Google Drive autorizado do usuário.', parameters: objectSchema({ query: stringProp('Termo da busca.'), maxResults: numberProp('Quantidade máxima entre 1 e 20.') }, ['query']) },
  { name: 'google_contacts_search', description: 'Pesquisa nome, e-mail ou telefone nos Contatos Google do usuário.', parameters: objectSchema({ query: stringProp('Nome, e-mail ou telefone para procurar.') }, ['query']) },
  { name: 'google_docs_create', description: 'Cria um documento no Google Docs autorizado do usuário.', parameters: objectSchema({ title: stringProp('Título do documento.'), text: stringProp('Texto inicial opcional.') }, ['title']) },
  { name: 'google_sheets_create', description: 'Cria uma planilha no Google Sheets autorizado do usuário.', parameters: objectSchema({ title: stringProp('Título da planilha.') }, ['title']) },
  { name: 'google_task_create', description: 'Cria uma tarefa no Google Tasks autorizado do usuário.', parameters: objectSchema({ title: stringProp('Título da tarefa.'), notes: stringProp('Notas opcionais.'), due: stringProp('Data de vencimento YYYY-MM-DD opcional.') }, ['title']) },
  { name: 'whatsapp_send_message', description: 'Envia uma mensagem de WhatsApp pela integração Evolution API, quando conectada. Use apenas quando o usuário pedir para enviar.', parameters: objectSchema({ recipient: stringProp('Nome ou telefone do destinatário.'), text: stringProp('Mensagem a enviar.') }, ['recipient', 'text']) },
  { name: 'pc_open_app', description: 'Abre um aplicativo permitido no agente Windows conectado. Use apenas para o PC/computador/Windows, nunca como substituto de android_open_app no celular.', parameters: objectSchema({ app: stringProp('Aplicativo permitido.') }, ['app']) },
  { name: 'pc_open_project', description: 'Abre um projeto permitido no agente Windows conectado.', parameters: objectSchema({ project: stringProp('Nome do projeto permitido pelo agente.') }, ['project']) },
  { name: 'pc_open_url', description: 'Abre uma URL http/https no navegador do agente Windows conectado.', parameters: objectSchema({ url: stringProp('URL http ou https.') }, ['url']) },
  { name: 'pc_git_status', description: 'Pede ao agente Windows o status Git do projeto atual/permitido.', parameters: objectSchema({}) },
  { name: 'pc_system_info', description: 'Consulta informações básicas do agente Windows conectado.', parameters: objectSchema({}) },
  { name: 'pc_codex_task', description: 'Delega uma tarefa de programação ao Codex CLI autenticado no agente Windows. Pode ser chamada mesmo quando a conversa da SEXTA está no celular; o Codex roda no PC. Use analyze para diagnóstico sem editar e edit apenas quando o usuário pedir para corrigir/alterar código. Só funciona em projetos permitidos na allowlist local do agente.', parameters: objectSchema({ project: stringProp('Nome exato do projeto configurado no agente Windows.'), task: stringProp('Tarefa objetiva para o Codex executar no projeto.'), mode: { type: 'string', enum: ['analyze', 'edit'], description: 'analyze não altera arquivos; edit permite alterações somente dentro do workspace.' } }, ['project', 'task']) },
  { name: 'pc_codex_status', description: 'Consulta o andamento ou resultado de uma tarefa Codex usando o commandId retornado por pc_codex_task.', parameters: objectSchema({ commandId: stringProp('ID do comando Codex retornado quando a tarefa foi iniciada.') }, ['commandId']) },
  { name: 'memory_list', description: 'Consulta memórias permanentes da SEXTA quando o contexto atual não for suficiente.', parameters: objectSchema({ query: stringProp('Termo opcional para filtrar as memórias.'), limit: numberProp('Quantidade máxima entre 1 e 20.') }) }
];

const ANDROID_TOOL_MAP = {
  android_open_app: ({ app }) => ({ action: 'open_app', payload: { app } }),
  android_open_settings: ({ section = '' }) => ({ action: 'open_settings', payload: { section } }),
  android_set_volume: ({ percent }) => ({ action: 'volume_set', payload: { percent: Math.max(0, Math.min(100, Number(percent))) } }),
  android_adjust_volume: ({ direction }) => ({ action: 'volume_adjust', payload: { direction } }),
  android_flashlight: ({ enabled }) => ({ action: 'flashlight', payload: { enabled: Boolean(enabled) } }),
  android_media: ({ command }) => ({ action: command === 'next' ? 'media_next' : command === 'previous' ? 'media_previous' : 'media_play_pause', payload: {} }),
  android_notifications: ({ app = '', limit = 10 }) => ({ action: 'notification_list', payload: { package: app, limit: Math.max(1, Math.min(20, Number(limit) || 10)) } }),
  android_reply_notification: ({ app = 'whatsapp', recipient = '', text = '' }) => ({ action: 'notification_reply', payload: { package: app, recipient, text } }),
  android_device_info: () => ({ action: 'device_info', payload: {} })
};

export function androidToolAction(name, args = {}) {
  const factory = ANDROID_TOOL_MAP[name];
  return factory ? factory(args || {}) : null;
}

function cleanResult(value) {
  if (value === undefined) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= 12000) return value;
    return { summary: json.slice(0, 11500), truncated: true };
  } catch {
    return { summary: String(value).slice(0, 11500) };
  }
}

async function requireGoogle() {
  const status = await googleStatus();
  if (!status.configured) throw new Error('GOOGLE_NOT_CONFIGURED');
  if (!status.connected) throw new Error('GOOGLE_NOT_CONNECTED');
}

function isPcExecutor(device = {}) {
  const caps = new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
  const context = device.context && typeof device.context === 'object' ? device.context : {};
  return Boolean(device.online && (String(device.kind || '').toLowerCase() === 'agent' || context.pcAgent === true || caps.has('open_project') || caps.has('git_status') || caps.has('get_system_info')));
}

function isNativeAndroid(device = {}) {
  const caps = new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
  const context = device.context && typeof device.context === 'object' ? device.context : {};
  return Boolean(device.online && (context.nativeAndroid === true || String(context.platform || '').toLowerCase() === 'android' || caps.has('flashlight') || caps.has('notification_reply') || caps.has('device_info')));
}

async function onlinePc() {
  const devices = await getDevices();
  return devices.find(isPcExecutor) || null;
}

async function androidTarget(originDeviceId = '') {
  const devices = await getDevices();
  const origin = originDeviceId ? devices.find(d => d.device_id === originDeviceId) : null;
  if (isNativeAndroid(origin)) return origin.device_id;
  return devices.find(isNativeAndroid)?.device_id || '';
}

export async function executeTool(name, args = {}, { preferLocalAndroid = false, deviceId = '' } = {}) {
  const localAndroid = androidToolAction(name, args);
  if (localAndroid) {
    if (preferLocalAndroid) {
      return { ok: true, handled: true, scope: 'android-local', state: 'ready_for_local_execution', clientAction: localAndroid };
    }
    const target = await androidTarget(deviceId);
    const queued = await queueAndroidAction(localAndroid.action, localAndroid.payload, target);
    return { ok: true, handled: true, scope: 'android', state: 'accepted', queued: true, commandId: queued.id, targetDeviceId: queued.target_device_id, action: localAndroid.action, message: 'Comando aceito pelo Android e aguardando confirmação de execução.' };
  }

  if (name === 'google_send_email') {
    await requireGoogle();
    const result = await executeWorkspaceAction('gmail.send-smart', { recipient: args.recipient, subject: args.subject || 'Mensagem da SEXTA', body: args.body || '' });
    return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result), message: `E-mail enviado para ${result.to}.` };
  }
  if (name === 'google_unread_email') { await requireGoogle(); const result = await executeWorkspaceAction('gmail.unread', { maxResults: Math.max(1, Math.min(10, Number(args.maxResults) || 5)) }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }
  if (name === 'google_calendar_list') { await requireGoogle(); const result = await executeWorkspaceAction('calendar.list', { day: args.day === 'tomorrow' ? 'tomorrow' : 'today' }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }
  if (name === 'google_calendar_create') { await requireGoogle(); if (!args.date && !args.startDateTime) throw new Error('CALENDAR_DATE_REQUIRED'); const result = await executeWorkspaceAction('calendar.create', args); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result), message: `Evento criado: ${result.summary || args.title}.` }; }
  if (name === 'google_drive_search') { await requireGoogle(); const result = await executeWorkspaceAction('drive.search', { query: args.query || '', maxResults: Math.max(1, Math.min(20, Number(args.maxResults) || 8)) }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }
  if (name === 'google_contacts_search') { await requireGoogle(); const result = await executeWorkspaceAction('contacts.search', { query: args.query || '' }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }
  if (name === 'google_docs_create') { await requireGoogle(); const result = await executeWorkspaceAction('docs.create', { title: args.title, text: args.text || '' }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }
  if (name === 'google_sheets_create') { await requireGoogle(); const result = await executeWorkspaceAction('sheets.create', { title: args.title }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }
  if (name === 'google_task_create') { await requireGoogle(); const result = await executeWorkspaceAction('tasks.create', { title: args.title, notes: args.notes || '', due: args.due || '' }); return { ok: true, handled: true, scope: 'google', state: 'completed', result: cleanResult(result) }; }

  if (name === 'whatsapp_send_message') {
    if (!evolutionStatus().configured) throw new Error('EVOLUTION_NOT_CONFIGURED');
    const sent = await sendWhatsAppText({ recipient: args.recipient, text: args.text });
    return { ok: true, handled: true, scope: 'whatsapp', state: 'completed', result: { to: sent.to }, message: `Mensagem enviada para ${sent.to.label}.` };
  }

  if (name === 'pc_codex_status') {
    const commandId = String(args.commandId || '').trim();
    if (!commandId) throw new Error('CODEX_COMMAND_ID_REQUIRED');
    const command = await getCommand(commandId);
    if (!command) throw new Error('CODEX_COMMAND_NOT_FOUND');
    const state = command.status === 'done' ? 'completed' : command.status === 'failed' ? 'failed' : command.status === 'queued' ? 'queued' : 'running';
    return { ok: command.status !== 'failed', handled: true, scope: 'pc-codex', state, commandId, result: cleanResult(command.result || null) };
  }

  if (name.startsWith('pc_')) {
    const pc = await onlinePc();
    if (!pc) throw new Error('NO_PC_AGENT_ONLINE');
    let action = '';
    let payload = {};
    if (name === 'pc_open_app') { action = 'open_app'; payload = { app: args.app }; }
    else if (name === 'pc_open_project') { action = 'open_project'; payload = { project: args.project }; }
    else if (name === 'pc_open_url') { action = 'open_url'; payload = { url: args.url }; }
    else if (name === 'pc_git_status') action = 'git_status';
    else if (name === 'pc_system_info') action = 'get_system_info';
    else if (name === 'pc_codex_task') {
      action = 'git_status';
      payload = {
        codexTask: true,
        project: String(args.project || '').trim().slice(0, 120),
        task: String(args.task || '').trim().slice(0, 12000),
        mode: args.mode === 'edit' ? 'edit' : 'analyze'
      };
      if (!payload.project || !payload.task) throw new Error('CODEX_PROJECT_AND_TASK_REQUIRED');
    }
    else throw new Error('PC_TOOL_NOT_ALLOWED');
    const command = await queueCommand(pc.device_id, action, payload);
    if (name === 'pc_codex_task') {
      return { ok: true, handled: true, scope: 'pc-codex', state: 'accepted', queued: true, commandId: command.id, target: pc.name, project: payload.project, mode: payload.mode, message: `Tarefa enviada ao Codex em ${pc.name}.` };
    }
    return { ok: true, handled: true, scope: 'pc', state: 'accepted', queued: true, commandId: command.id, target: pc.name, action, message: `Comando enviado para ${pc.name}; aguardando confirmação do agente Windows.` };
  }

  if (name === 'memory_list') {
    const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
    const memories = await getMemories(Math.max(limit, 20));
    const q = String(args.query || '').trim().toLocaleLowerCase('pt-BR');
    const result = (q ? memories.filter(m => String(m.content || '').toLocaleLowerCase('pt-BR').includes(q)) : memories).slice(0, limit);
    return { ok: true, handled: true, scope: 'memory', state: 'completed', result: cleanResult(result) };
  }

  throw new Error('TOOL_NOT_ALLOWED');
}

export async function planAndExecuteTools(message, { deviceId = '', maxRounds = 4 } = {}) {
  const c = config();
  if (!c.geminiKey || !String(message || '').trim()) return { handled: false, calls: [], results: [] };
  const model = process.env.GEMINI_TOOL_MODEL || c.geminiModel || 'gemini-3.7-flash';
  const contents = [{ role: 'user', parts: [{ text: String(message).trim() }] }];
  const calls = [];
  const results = [];

  for (let round = 0; round < Math.max(1, Math.min(6, maxRounds)); round += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.geminiKey },
      body: JSON.stringify({ contents, tools: [{ functionDeclarations: LIVE_TOOL_DECLARATIONS }], toolConfig: { functionCallingConfig: { mode: 'AUTO' } }, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GEMINI_TOOL_${response.status}: ${data?.error?.message || 'tool planner failed'}`);
    const content = data?.candidates?.[0]?.content;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const functionCalls = parts.filter(part => part?.functionCall).map(part => part.functionCall);
    if (!functionCalls.length) return { handled: calls.length > 0, calls, results, modelText: parts.map(part => part.text || '').filter(Boolean).join('\n').trim() };
    contents.push(content);
    const responseParts = [];
    for (const call of functionCalls) {
      const callName = String(call.name || '');
      const callArgs = call.args && typeof call.args === 'object' ? call.args : {};
      calls.push({ id: call.id || '', name: callName, args: callArgs });
      let result;
      try { result = await executeTool(callName, callArgs, { deviceId }); }
      catch (error) { result = { ok: false, handled: true, state: 'failed', error: String(error?.message || error) }; }
      results.push({ name: callName, result });
      responseParts.push({ functionResponse: { ...(call.id ? { id: call.id } : {}), name: callName, response: result } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { handled: calls.length > 0, calls, results };
}
