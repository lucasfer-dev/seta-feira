import { normalizePersonality, SEXTA_PERSONALITY_DEFAULTS } from './sexta-personality.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const defaults = { ...SEXTA_PERSONALITY_DEFAULTS, personalityVersion:'2.0.0', voice:true, autoSpeak:true, speakNotifications:true, notificationThreshold:62, whatsappNotifyAll:true };
const state = {
  token: localStorage.getItem('sexta_token') || '',
  conversationId: localStorage.getItem('sexta_conversation') || crypto.randomUUID(),
  deviceId: localStorage.getItem('sexta_device_id') || crypto.randomUUID(),
  health: null, google: { configured:false, connected:false }, evolution: { configured:false, connected:false }, messages: [], memories: [], vaultNotes: [], vaultStatus: { native:false, configured:false, syncing:false, lastSync:'' }, devices: [], events: [], notifications: [], settings: { ...defaults },
  busy: false, wakeActive: false, lastRemoteMessageId: localStorage.getItem('sexta_last_remote') || '', notifiedIds: new Set(JSON.parse(localStorage.getItem('sexta_notified_ids') || '[]'))
};
localStorage.setItem('sexta_device_id', state.deviceId);
localStorage.setItem('sexta_conversation', state.conversationId);

const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const desktopApp = /Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop);
const deviceKind = desktopApp ? 'desktop' : mobile ? 'phone' : 'browser';
const deviceName = desktopApp ? 'SEXTA Desktop' : mobile ? 'Celular' : `Navegador • ${navigator.platform || 'PC'}`;

function authHeaders(extra = {}) { return { ...extra, ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) }; }
async function api(path, options = {}) {
  const r = await fetch(path, { ...options, headers: authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) }) });
  if (r.status === 401 && path !== '/api/login') {
    state.token = ''; localStorage.removeItem('sexta_token'); showLogin(); throw new Error('Sessão expirada');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || data.error || `Erro ${r.status}`);
  return data;
}

function escapeHtml(text='') { return String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function formatText(text='') {
  let s = escapeHtml(text);
  s = s.replace(/```([\s\S]*?)```/g, (_,code) => `<pre><code>${code.trim()}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\n/g, '<br>');
  return s;
}
function relativeTime(date) {
  const ms = Date.now() - new Date(date).getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 60000) return 'agora'; if (ms < 3600000) return `${Math.floor(ms/60000)} min`;
  if (ms < 86400000) return `${Math.floor(ms/3600000)} h`; return new Date(date).toLocaleDateString('pt-BR');
}
function greeting() {
  const h = new Date().getHours(); return h < 12 ? 'Bom dia.' : h < 18 ? 'Boa tarde.' : 'Boa noite.';
}
function toast(title, body='', type='') {
  const el = document.createElement('div'); el.className = `toast ${type}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${escapeHtml(body)}`; $('#toastRegion').append(el);
  setTimeout(() => el.remove(), 4200);
}

function setHealthUI() {
  const h = state.health || {};
  $('#cloudDot').className = `dot ${h.cloud ? 'ok' : 'warn'}`;
  $('#cloudLabel').textContent = h.cloud ? 'Memória cloud ativa' : 'Modo local/demo';
  $('#brainDot').className = `dot ${h.ai === 'gemini' ? 'ok' : 'warn'}`;
  $('#brainLabel').textContent = h.ai === 'gemini' ? `Gemini • ${h.model}` : 'Cérebro demo';
  $('#presenceText').textContent = h.ai === 'gemini' ? 'Sexta online' : 'Sexta em demo';
}

function renderMessages() {
  const box = $('#messages');
  if (!state.messages.length) {
    box.innerHTML = `<article class="message assistant"><div class="avatar">S</div><div class="bubble"><div class="bubble-meta">SEXTA • agora</div><div class="bubble-content">${formatText(`Estou aqui. Esta é a mesma conversa no celular e no PC. ${state.health?.ai === 'gemini' ? 'O cérebro está conectado.' : 'No momento estou com o cérebro de demonstração; conecte o Gemini para a conversa completa.'}`)}</div></div></article>`;
    return;
  }
  box.innerHTML = state.messages.map(m => {
    const assistant = m.role === 'assistant';
    return `<article class="message ${assistant ? 'assistant' : 'user'}">${assistant ? '<div class="avatar">S</div>' : ''}<div class="bubble"><div class="bubble-meta">${assistant ? 'SEXTA' : 'VOCÊ'} • ${relativeTime(m.created_at)}</div><div class="bubble-content">${formatText(m.content)}</div>${m.memorySaved ? '<span class="memory-tag">⌁ memória guardada</span>' : ''}</div></article>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

function renderMemories() {
  $('#memoryCount').textContent = state.memories.length;
  $('#focusMemories').innerHTML = state.memories.length ? state.memories.slice(0,3).map(m => `<div class="focus-item">${escapeHtml(m.content)}</div>`).join('') : '<p class="muted">Nenhuma memória ainda.</p>';
  $('#memoryGrid').innerHTML = state.memories.length ? state.memories.map(m => `<article class="memory-card"><div class="memory-top"><span class="memory-kind">${escapeHtml(m.kind || 'fact')}</span><button class="memory-delete" data-memory-id="${m.id}" title="Apagar">×</button></div><p>${escapeHtml(m.content)}</p><footer>importância ${Math.round(Number(m.importance || .6)*100)}% • ${relativeTime(m.updated_at || m.created_at)}</footer></article>`).join('') : '<div class="empty-state">Ainda não há memórias permanentes. Diga “Sexta, lembra que...” ou adicione uma manualmente.</div>';
  $$('.memory-delete').forEach(btn => btn.onclick = () => removeMemory(btn.dataset.memoryId));
}

function nativeVaultBridge() {
  if (window.sextaDesktop?.vault) {
    return {
      type: 'desktop',
      status: () => window.sextaDesktop.vault.status(),
      choose: () => window.sextaDesktop.vault.choose(),
      read: () => window.sextaDesktop.vault.read(),
      write: (notes) => window.sextaDesktop.vault.write(notes),
      open: () => window.sextaDesktop.vault.open()
    };
  }
  const plugin = window.Capacitor?.Plugins?.VaultBridge;
  if (plugin) {
    return {
      type: 'android',
      status: () => plugin.status(),
      choose: () => plugin.chooseVault(),
      read: () => plugin.readNotes(),
      write: (notes) => plugin.writeNotes({ notes }),
      open: () => plugin.openObsidian()
    };
  }
  return null;
}
function renderVault() {
  const notes = state.vaultNotes || [];
  const vs = state.vaultStatus || {};
  const badge = $('#vaultStatusBadge');
  if (!badge) return;
  $('#vaultNoteCount').textContent = notes.length;
  $('#vaultMemoryCount').textContent = notes.filter(n => n.source_memory_id || n.kind === 'memory' || n.kind === 'fact').length;
  $('#vaultLastSync').textContent = vs.lastSync ? new Date(vs.lastSync).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—';
  badge.className = 'integration-badge';
  if (vs.syncing) { badge.textContent = 'sincronizando'; badge.classList.add('warn'); }
  else if (vs.configured) { badge.textContent = 'espelhado'; badge.classList.add('ok'); }
  else { badge.textContent = 'cloud'; }
  const location = vs.vaultPath || vs.treeName || '';
  $('#vaultStatusText').textContent = vs.configured
    ? `Vault cloud + cópia local${location ? ` • ${location}` : ''}. Alterações do Obsidian voltam para a memória da Sexta.`
    : `${notes.length} nota(s) no Vault cloud. Escolha uma pasta no app Windows/Android para espelhar no Obsidian.`;
  $('#vaultHelp').textContent = nativeVaultBridge()
    ? 'Sync bidirecional: primeiro a Sexta envia edições locais para a nuvem e depois baixa a versão mais recente. Conflitos preservam a versão cloud mais nova.'
    : 'No navegador comum o Vault cloud funciona, mas o acesso à pasta local exige o programa Windows ou o app Android.';
  $('#vaultChooseBtn').disabled = !nativeVaultBridge();
  $('#vaultOpenBtn').disabled = !nativeVaultBridge() || !vs.configured;
  $('#vaultNoteList').innerHTML = notes.slice(0,18).map(n => `<span class="vault-note-chip ${n.source_memory_id?'memory':''}" title="${escapeHtml(n.path)}">${escapeHtml(n.path)}</span>`).join('') || '<span class="vault-note-chip">Vault vazio</span>';
}
async function loadVault({silent=true}={}) {
  if (!state.token) return;
  try {
    const data = await api('/api/vault');
    state.vaultNotes = data.notes || [];
    const bridge = nativeVaultBridge();
    if (bridge) {
      try {
        const st = await bridge.status();
        state.vaultStatus = { ...state.vaultStatus, native:true, configured:Boolean(st?.configured), vaultPath:st?.vaultPath||'', treeName:st?.treeName||'' };
      } catch { state.vaultStatus = { ...state.vaultStatus, native:true }; }
    }
    renderVault();
  } catch (e) { if(!silent) toast('Vault',e.message,'error'); }
}
async function chooseVaultFolder() {
  const bridge = nativeVaultBridge();
  if (!bridge) return toast('Vault local indisponível','Use o programa Windows ou o app Android para escolher a pasta que o Obsidian usa.','error');
  try {
    const result = await bridge.choose();
    if (result?.canceled) return;
    state.vaultStatus = { ...state.vaultStatus, configured:Boolean(result?.ok ?? true), vaultPath:result?.vaultPath||'', treeName:result?.treeName||'' };
    renderVault();
    await syncObsidianVault();
  } catch(e) { toast('Não consegui abrir a pasta do Vault',e.message,'error'); }
}
async function syncObsidianVault({silent=false}={}) {
  if (!state.token) return;
  const bridge = nativeVaultBridge();
  state.vaultStatus = { ...state.vaultStatus, syncing:true };
  renderVault();
  try {
    let cloud = (await api('/api/vault')).notes || [];
    let conflicts = 0;
    let uploaded = 0;
    let written = 0;
    if (bridge) {
      const st = await bridge.status().catch(()=>({configured:false}));
      state.vaultStatus = { ...state.vaultStatus, native:true, configured:Boolean(st?.configured), vaultPath:st?.vaultPath||'', treeName:st?.treeName||'' };
      if (st?.configured) {
        const local = await bridge.read();
        const cloudByPath = new Map(cloud.map(n => [n.path,n]));
        const changed = (local?.notes || []).filter(n => n?.path && typeof n.markdown === 'string' && cloudByPath.get(n.path)?.markdown !== n.markdown);
        if (changed.length) {
          const pushed = await api('/api/vault',{method:'POST',body:JSON.stringify({notes:changed.slice(0,300)})});
          conflicts = pushed.conflicts || 0;
          uploaded = pushed.notes?.filter(n=>!n.conflict && !n.unchanged).length || 0;
        }
        cloud = (await api('/api/vault')).notes || [];
        const result = await bridge.write(cloud.map(n => ({path:n.path,markdown:n.markdown,updated_at:n.updated_at})));
        written = Number(result?.written || 0);
      }
    }
    state.vaultNotes = cloud;
    state.vaultStatus = { ...state.vaultStatus, syncing:false, lastSync:new Date().toISOString() };
    renderVault();
    if(!silent) toast('Vault sincronizado', bridge && state.vaultStatus.configured ? `${uploaded} enviada(s), ${written} atualizada(s) localmente${conflicts?`, ${conflicts} conflito(s) resolvido(s) pela versão mais nova`:''}.` : 'Memória cloud atualizada. O espelho local será ativado quando você escolher um Vault.', 'success');
  } catch(e) {
    state.vaultStatus = { ...state.vaultStatus, syncing:false };
    renderVault();
    if(!silent) toast('Falha no Vault',e.message,'error');
  }
}
async function openObsidianVault() {
  const bridge = nativeVaultBridge();
  if (!bridge) return toast('Obsidian','Abra pelo programa Windows ou pelo app Android depois de escolher o Vault.','error');
  try { await bridge.open(); }
  catch(e) { toast('Não consegui abrir o Obsidian',e.message,'error'); }
}

function iconForDevice(kind){ return kind === 'phone' ? '▯' : kind === 'agent' || kind === 'desktop' ? '▣' : kind === 'tablet' ? '▤' : '◈'; }
function renderDevices() {
  $('#deviceCount').textContent = state.devices.filter(d => d.online).length;
  $('#devicesGrid').innerHTML = state.devices.length ? state.devices.map(d => `<article class="device-card"><div class="device-icon">${iconForDevice(d.kind)}</div><div><h3>${escapeHtml(d.name)}</h3><p>${escapeHtml(d.kind)} • visto ${relativeTime(d.last_seen)}</p><div class="capabilities">${(d.capabilities||[]).slice(0,6).map(c=>`<span>${escapeHtml(c)}</span>`).join('') || '<span>chat</span>'}</div></div><span class="device-status ${d.online?'online':''}">${d.online?'● online':'○ offline'}</span></article>`).join('') : '<div class="empty-state">Nenhum dispositivo sincronizado ainda.</div>';
}

function renderEvents() {
  $('#activityTimeline').innerHTML = state.events.length ? state.events.map(e => `<article class="timeline-item ${e.level || ''}"><span class="timeline-dot"></span><div><strong>${escapeHtml(e.title)}</strong><p>${escapeHtml(e.body || '')}</p></div><time>${relativeTime(e.created_at)}</time></article>`).join('') : '<div class="empty-state">Nenhuma ação registrada. Quando o agente executar algo, aparece aqui.</div>';
}

function priorityLabel(n){ return n.priority>=82?'urgente':n.priority>=62?'importante':n.priority>=38?'normal':'baixo'; }
function renderNotifications(){
  const list=state.notifications||[];
  const unread=list.filter(n=>n.status==='unread');
  $('#notificationCount').textContent=unread.length;
  $('#notificationImportantCount').textContent=unread.filter(n=>Number(n.priority)>=62).length;
  $('#notificationWhatsappCount').textContent=unread.filter(n=>n.source==='whatsapp').length;
  $('#notificationGmailCount').textContent=unread.filter(n=>n.source==='gmail').length;
  const box=$('#notificationList'); if(!box)return;
  box.innerHTML=list.length?list.map(n=>`<article class="notification-card ${escapeHtml(priorityLabel(n))} ${n.status!=='unread'?'is-read':''}">
    <div class="notification-source">${n.source==='whatsapp'?'W':'G'}</div>
    <div class="notification-body"><div class="notification-meta"><span>${escapeHtml(n.source==='whatsapp'?'WHATSAPP':'GMAIL')}</span><b>${escapeHtml(priorityLabel(n))} • ${Math.round(Number(n.priority||0))}</b><time>${relativeTime(n.created_at)}</time></div><h3>${escapeHtml(n.title)}</h3>${n.sender?`<small>${escapeHtml(n.sender)}</small>`:''}<p>${escapeHtml(n.body||'')}</p>${n.reason?`<em>${escapeHtml(n.reason)}</em>`:''}</div>
    <div class="notification-actions"><button data-notification-action="read" data-id="${n.id}">✓</button><button data-notification-action="dismissed" data-id="${n.id}">×</button></div>
  </article>`).join(''):'<div class="empty-state">Nada importante por aqui. A Sexta está fazendo o trabalho ingrato de filtrar o barulho.</div>';
  $$('[data-notification-action]').forEach(b=>b.onclick=()=>markNotification(b.dataset.id,b.dataset.notificationAction));
}
async function markNotification(id,status){ try{await api('/api/notifications/action',{method:'POST',body:JSON.stringify({id,status})}); await sync({silent:true});}catch(e){toast('Notificação',e.message,'error')} }
function notificationPermissionUI(){
  const perm=('Notification'in window)?Notification.permission:'unsupported';
  const badge=$('#notificationPermissionBadge'),text=$('#notificationPermissionText'); if(!badge||!text)return;
  badge.className='integration-badge';
  if(perm==='granted'){badge.textContent='permitido';badge.classList.add('ok');text.textContent='Este dispositivo pode receber alertas enquanto a Sexta estiver ativa.';}
  else if(perm==='denied'){badge.textContent='bloqueado';badge.classList.add('warn');text.textContent='O navegador bloqueou notificações. Altere a permissão do site.';}
  else if(perm==='unsupported'){badge.textContent='indisponível';badge.classList.add('warn');text.textContent='Este navegador não oferece Notification API.';}
  else {badge.textContent='permitir';badge.classList.add('warn');text.textContent='Permita alertas para receber avisos importantes.';}
}
async function enableDeviceNotifications(){
  if(!('Notification'in window))return toast('Notificações','Este navegador não oferece notificações do sistema.','error');
  const p=await Notification.requestPermission(); notificationPermissionUI();
  if(p==='granted') toast('Alertas ativados','A Sexta pode te chamar quando algo realmente importar.','success');
}
function surfaceNewNotifications(previousIds=new Set()){
  const threshold=Number(state.settings.notificationThreshold??62);
  const fresh=(state.notifications||[]).filter(n=>n.status==='unread'&&!previousIds.has(n.id)&&!state.notifiedIds.has(n.id));
  for(const n of fresh){
    const shouldAlert=n.source==='whatsapp'?(state.settings.whatsappNotifyAll!==false || Number(n.priority)>=threshold):Number(n.priority)>=threshold;
    if(!shouldAlert)continue;
    state.notifiedIds.add(n.id);
    const ids=[...state.notifiedIds].slice(-120); localStorage.setItem('sexta_notified_ids',JSON.stringify(ids));
    if('Notification'in window&&Notification.permission==='granted'){
      try{new Notification(n.title||'SEXTA',{body:`${n.sender?`${n.sender}: `:''}${n.body||''}`.slice(0,220),tag:`sexta-${n.id}`});}catch{}
    }
    toast(n.source==='whatsapp'?'WhatsApp':'E-mail importante',`${n.sender?`${n.sender}: `:''}${n.body||n.title}`.slice(0,180),Number(n.priority)>=82?'error':'success');
    if(state.settings.speakNotifications!==false&&state.settings.voice!==false&&Number(n.priority)>=threshold){
      const source=n.source==='whatsapp'?'mensagem no WhatsApp':'e-mail';
      speak(`Chegou ${source} ${Number(n.priority)>=82?'urgente':'importante'} de ${n.sender||'um contato'}. ${String(n.body||n.title).slice(0,220)}`);
    }
  }
}

function applySettingsUI() {
  const s = { ...defaults, ...state.settings, ...normalizePersonality(state.settings) };
  state.settings = s;
  localStorage.setItem('sexta_personality', JSON.stringify(normalizePersonality(s)));
  $('#settingName').value = s.name; $('#settingHumor').value = s.humor; $('#settingSarcasm').value = s.sarcasm;
  $('#settingProactivity').value = s.proactivity; $('#settingVerbosity').value = s.verbosity; $('#settingConfidence').value = s.confidence; $('#settingFormality').value = s.formality; $('#settingWarmth').value = s.warmth;
  $('#settingVoice').checked = s.voice !== false; $('#settingAutoSpeak').checked = Boolean(s.autoSpeak); $('#settingSpeakNotifications').checked = s.speakNotifications !== false; $('#settingNotificationThreshold').value = s.notificationThreshold ?? 62; $('#settingNotificationThreshold').nextElementSibling.textContent = $('#settingNotificationThreshold').value; $('#settingWhatsappNotifyAll').checked = s.whatsappNotifyAll !== false;
  ['Humor','Sarcasm','Proactivity','Verbosity','Confidence','Formality','Warmth','NotificationThreshold'].forEach(key => { const input = $(`#setting${key}`); input.nextElementSibling.textContent = input.value; });
  updatePersonalityPreview();
}
function readSettingsUI() { return { ...normalizePersonality({ name:$('#settingName').value || 'Sexta-feira', humor:+$('#settingHumor').value, sarcasm:+$('#settingSarcasm').value, proactivity:+$('#settingProactivity').value, verbosity:+$('#settingVerbosity').value, confidence:+$('#settingConfidence').value, formality:+$('#settingFormality').value, warmth:+$('#settingWarmth').value, personalityVersion:'2.0.0' }), voice:$('#settingVoice').checked, autoSpeak:$('#settingAutoSpeak').checked, speakNotifications:$('#settingSpeakNotifications').checked, notificationThreshold:+$('#settingNotificationThreshold').value, whatsappNotifyAll:$('#settingWhatsappNotifyAll').checked }; }
function updatePersonalityPreview(){
  const s = readSettingsUI();
  let line = 'Estou aqui. O que você precisa?';
  if (s.humor > 70 && s.sarcasm > 60) line = 'Estou aqui. Vamos descobrir o que decidiu parar de funcionar.';
  else if (s.humor > 60) line = 'Estou aqui. Qual é o plano?';
  else if (s.verbosity < 20) line = 'Estou aqui. Manda.';
  $('#personalityPreview').textContent = `“${line}”`;
}

function updateContext() {
  $('#viewTitle').textContent = greeting();
  $('#thisDeviceName').textContent = deviceName; $('#thisDeviceKind').textContent = deviceKind;
  $('#contextDeviceName').textContent = deviceName; $('#contextDeviceMeta').textContent = `${deviceKind} • online`;
  $('#contextDeviceIcon').textContent = iconForDevice(deviceKind);
  const lastUser = [...state.messages].reverse().find(m=>m.role==='user');
  if (lastUser) { const short = lastUser.content.replace(/\s+/g,' ').slice(0,58); $('#currentTopic').textContent = short + (lastUser.content.length>58?'…':''); $('#currentTopicMeta').textContent = `Atualizado ${relativeTime(lastUser.created_at)}`; }
}

function showView(name) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  const labels = { chat:['CONVERSA ATIVA',greeting()], memory:['MEMÓRIA DE LONGO PRAZO','Memória'], devices:['CORPOS CONECTADOS','Dispositivos'], activity:['EVENTOS E AÇÕES','Atividade'], notifications:['CAIXA INTELIGENTE','Notificações'], integrations:['BRAÇOS EXTERNOS','Integrações'], settings:['DNA DA SEXTA','Personalidade'] };
  $('#viewEyebrow').textContent = labels[name]?.[0] || ''; $('#viewTitle').textContent = labels[name]?.[1] || '';
  if(name === 'memory') loadVault({silent:true});
}

function showLogin(){ const d=$('#loginDialog'); if(!d.open) d.showModal(); setTimeout(()=>$('#pinInput').focus(),50); }
async function login(pin='') {
  const data = await api('/api/login', { method:'POST', body:JSON.stringify({pin}) });
  state.token = data.token; localStorage.setItem('sexta_token',state.token); if($('#loginDialog').open) $('#loginDialog').close();
}

async function loadGoogleStatus(){
  if(!state.token) return;
  try{
    state.google=await api('/api/google/status');
    renderGoogleStatus();
  }catch{ state.google={configured:false,connected:false}; renderGoogleStatus(); }
}
function renderGoogleStatus(){
  const g=state.google||{};
  const text=$('#googleStatusText'), badge=$('#googleStatusBadge'), btn=$('#googleConnectBtn'), test=$('#googleTestBtn');
  if(!text||!badge||!btn) return;
  badge.className='integration-badge';
  if(g.connected){ text.textContent='Conta autorizada. Workspace pronto para voz.'; badge.textContent='conectado'; badge.classList.add('ok'); btn.textContent='Reconectar Google'; test.disabled=false; }
  else if(g.configured){ text.textContent='OAuth configurado. Falta autorizar sua conta Google.'; badge.textContent='autorizar'; badge.classList.add('warn'); btn.textContent='Conectar Google'; test.disabled=true; }
  else { text.textContent='Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.'; badge.textContent='configurar'; badge.classList.add('warn'); btn.textContent='Configurar OAuth'; test.disabled=true; }
}
async function connectGoogle(){
  try{
    const d=await api('/api/google/auth-url');
    window.location.href=d.url;
  }catch(e){
    toast('Google Workspace', e.message==='GOOGLE_OAUTH_NOT_CONFIGURED'?'Faltam GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env.local.':e.message, 'error');
    showView('integrations');
  }
}
async function testGoogleCalendar(){
  try{ const d=await api('/api/google/action',{method:'POST',body:JSON.stringify({action:'calendar.list',args:{day:'tomorrow'}})}); addAssistantReply(d.reply,{speakNow:true,deviceId:'google-workspace'}); }
  catch(e){ toast('Teste do Google',e.message,'error'); }
}

async function loadEvolutionStatus(){
  if(!state.token)return;
  try{state.evolution=await api('/api/evolution/status');}catch{state.evolution={configured:false,connected:false};}
  renderEvolutionStatus();
}
function renderEvolutionStatus(){
  const e=state.evolution||{},text=$('#evolutionStatusText'),badge=$('#evolutionStatusBadge'),webhook=$('#evolutionWebhookBtn'); if(!text||!badge)return;
  badge.className='integration-badge';
  if(e.connected){text.textContent=`Instância ${e.instance||''} conectada ao WhatsApp.`;badge.textContent='online';badge.classList.add('ok');}
  else if(e.configured){text.textContent=`Evolution configurada (${e.state||'estado não confirmado'}).`;badge.textContent='configurada';badge.classList.add('warn');}
  else{text.textContent='Faltam EVOLUTION_BASE_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE.';badge.textContent='configurar';badge.classList.add('warn');}
  if(webhook) webhook.disabled=!e.configured;
}
async function configureEvolution(){
  try{await api('/api/evolution/configure-webhook',{method:'POST',body:'{}'});toast('WhatsApp','Webhook da Evolution configurado.','success');await loadEvolutionStatus();}
  catch(e){toast('Evolution API',e.message,'error')}
}
async function testEvolution(){await loadEvolutionStatus();toast('Evolution API',state.evolution.connected?'WhatsApp conectado.':state.evolution.configured?'Configuração encontrada, mas a conexão ainda não abriu.':'Evolution ainda não configurada.',state.evolution.connected?'success':'warn')}
async function runNotificationMonitor(){
  try{const d=await api('/api/monitor/run',{method:'POST',body:'{}'});toast('Triagem concluída',d.results?.gmail?.ok?`${d.results.gmail.added||0} novo(s) e-mail(s) processado(s).`:'Gmail ainda não está conectado.','success');await sync({silent:true});}
  catch(e){toast('Monitor',e.message,'error')}
}
async function importChatGPTResponse(){
  let text='';
  try{ text=(await navigator.clipboard.readText()).trim(); }catch{}
  if(!text){
    try{
      const queued=await command('read_clipboard',{});
      const id=queued?.command?.id;
      if(id){
        for(let i=0;i<12;i++){
          await new Promise(r=>setTimeout(r,500));
          const d=await api(`/api/command-status?id=${encodeURIComponent(id)}`);
          if(d.command?.status==='done'){ text=String(d.command.result?.text||'').trim(); break; }
          if(d.command?.status==='failed') throw new Error('O agente Windows não conseguiu ler o clipboard.');
        }
      }
    }catch{}
  }
  if(!text){
    toast('Não consegui ler o clipboard','Copie a resposta no ChatGPT. Se estiver usando voz, deixe o agente Windows online ou use o botão de importar.', 'error');
    if(state.settings.voice!==false) speak('Não consegui ler a área de transferência. Copie a resposta e tente novamente.');
    return;
  }
  try{
    await api('/api/import-response',{method:'POST',body:JSON.stringify({conversationId:state.conversationId,content:text})});
    addAssistantReply(text,{speakNow:true,deviceId:'chatgpt-handoff'});
    toast('Resposta importada','A Sexta trouxe a resposta do ChatGPT para esta conversa.','success');
    setTimeout(()=>sync({silent:true}),300);
  }catch(e){toast('Importação falhou',e.message,'error')}
}
function isChatGPTImportCommand(text){ return /(?:pega|pegue|importa|importe|traz|traga).*(?:resposta|retorno).*(?:chatgpt|chat gpt)|(?:chatgpt|chat gpt).*(?:resposta).*(?:pega|importa|traz)/i.test(String(text||'')); }

async function heartbeat() {
  if (!state.token) return;
  const capabilities = ['chat','voice','camera'];
  try { await api('/api/device-heartbeat',{method:'POST',body:JSON.stringify({deviceId:state.deviceId,name:deviceName,kind:deviceKind,capabilities,context:{userAgent:navigator.userAgent.slice(0,180),visibility:document.visibilityState,path:location.pathname}})}); } catch {}
}

async function sync({silent=false}={}) {
  if (!state.token) return;
  try {
    const data = await api(`/api/sync?conversationId=${encodeURIComponent(state.conversationId)}`);
    const previousLast = state.messages.at(-1)?.id;
    const previousNotificationIds = new Set((state.notifications||[]).map(n=>n.id));
    state.messages = data.messages || []; state.memories = data.memories || []; state.devices = data.devices || []; state.events = data.events || []; state.notifications = data.notifications || [];
    if (data.settings && Object.keys(data.settings).length) state.settings = { ...defaults, ...data.settings };
    renderMessages(); renderMemories(); renderDevices(); renderEvents(); renderNotifications(); applySettingsUI(); updateContext();
    surfaceNewNotifications(previousNotificationIds);
    const last = state.messages.at(-1);
    if (last?.id && last.id !== previousLast && last.device_id && !['cloud-core',state.deviceId].includes(last.device_id) && state.lastRemoteMessageId !== last.id) {
      state.lastRemoteMessageId = last.id; localStorage.setItem('sexta_last_remote',last.id); $('#handoffText').textContent = `Nova atividade veio de ${last.device_id}.`; $('#handoffBanner').classList.remove('hidden');
    }
    $('#syncHint').textContent = `sincronizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;
    if(!silent) toast('Sincronizado','Memória e dispositivos atualizados.','success');
  } catch(error) { if(!silent) toast('Falha ao sincronizar',error.message,'error'); }
}

function addAssistantReply(reply, { speakNow = false, deviceId = 'cloud-core', memorySaved = false } = {}) {
  const content = String(reply || '').trim();
  if (!content) return;
  state.messages.push({ id:`local-a-${Date.now()}-${Math.random().toString(16).slice(2)}`, role:'assistant', content, device_id:deviceId, created_at:new Date().toISOString(), memorySaved });
  renderMessages();
  if (state.settings.voice !== false && (speakNow || state.settings.autoSpeak)) speak(content);
}

function localFastReply(text) {
  const t = String(text || '').toLowerCase().trim();
  const now = new Date();
  if (/^(oi|ol[aá]|e a[ií]|fala|sexta(?:[- ]feira)?)[!?., ]*$/.test(t)) return 'Estou aqui. Manda.';
  if (/\b(que horas|qual a hora|horas são|hora agora)\b/.test(t)) return `Agora são ${now.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.`;
  if (/\b(que dia|qual a data|data de hoje|dia é hoje)\b/.test(t)) return `Hoje é ${now.toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}.`;
  if (/\b(como você (está|ta|tá)|tudo bem com você|como cê tá)\b/.test(t)) return 'Operacional e julgando silenciosamente suas próximas decisões. Então, tudo normal.';
  if (/\b(quem é você|se apresente|me apresente|o que você é)\b/.test(t)) return 'Sou a Sexta-feira: sua assistente entre celular e PC. Eu cuido do contexto, memória e ações; uso IA só quando realmente preciso pensar.';
  if (/^(obrigad[oa]|valeu|vlw|brigad[oa])[!. ]*$/.test(t)) return 'Disponha.';
  return '';
}

function detectDirectCommand(text) {
  const t = String(text || '').toLowerCase().trim();
  if (/\b(abre|abrir)\b.*\b(vscode|vs code|visual studio code)\b/.test(t)) return { action:'open_app', payload:{app:'vscode'}, reply:'Abrindo o VS Code no seu PC.' };
  if (/\b(abre|abrir)\b.*\bspotify\b/.test(t)) return { action:'open_app', payload:{app:'spotify'}, reply:'Abrindo o Spotify no seu PC.' };
  if (/\b(abre|abrir)\b.*\b(chrome|navegador|browser)\b/.test(t)) return { action:'open_app', payload:{app:'browser'}, reply:'Abrindo o navegador no seu PC.' };
  if (/\b(status|situa[cç][aã]o)\b.*\bgit\b|\bgit\b.*\b(status|situa[cç][aã]o)\b/.test(t)) return { action:'git_status', payload:{}, reply:'Consultando o Git no seu PC.' };
  if (/\b(status|estado|como est[aá])\b.*\b(pc|computador)\b/.test(t)) return { action:'get_system_info', payload:{}, reply:'Consultando o estado do seu PC.' };
  return null;
}

async function handoffToChatGPT(text) {
  const prompt = String(text || '').trim();
  if (!prompt) return false;
  try { await navigator.clipboard.writeText(prompt); } catch {}
  const opened = window.open('https://chatgpt.com/', '_blank', 'noopener,noreferrer');
  if (!opened) {
    toast('ChatGPT','O navegador bloqueou a nova aba. Vou abrir nesta aba; o pedido já está copiado.','warn');
    setTimeout(()=>{ window.location.href='https://chatgpt.com/'; },700);
  } else {
    toast('ChatGPT aberto','Deixei o pedido copiado. Cole na conversa e envie.','success');
  }
  addAssistantReply('Abri o ChatGPT e deixei seu pedido copiado. É só colar e enviar.', { speakNow:true, deviceId:'local' });
  return true;
}

function extractChatGPTHandoff(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(?:sexta(?:[- ]feira)?[, ]*)?(?:pergunta|pergunte|manda|mande)(?: isso)? (?:pro|para o) chatgpt[,: ]+(.+)$/i);
  return m?.[1]?.trim() || '';
}

async function sendMessage(text, { voiceRequest = false } = {}) {
  text = String(text || '').trim(); if(!text || state.busy) return;

  state.messages.push({id:`local-${Date.now()}`,role:'user',content:text,device_id:state.deviceId,created_at:new Date().toISOString()}); renderMessages(); updateContext();

  if (isChatGPTImportCommand(text)) { await importChatGPTResponse(); return; }
  const handoff = extractChatGPTHandoff(text);
  if (handoff) { await handoffToChatGPT(handoff); return; }

  const direct = detectDirectCommand(text);
  if (direct) {
    try {
      await command(direct.action,direct.payload);
      addAssistantReply(direct.reply,{speakNow:voiceRequest,deviceId:'local-action'});
    } catch {}
    return;
  }

  const quick = localFastReply(text);
  if (quick) { addAssistantReply(quick,{speakNow:voiceRequest,deviceId:'local-fast'}); return; }

  state.busy = true; $('#thinking').classList.remove('hidden'); $('#sendBtn').disabled = true;
  try {
    const context = { device: { id:state.deviceId,name:deviceName,kind:deviceKind }, onlineDevices: state.devices.filter(d=>d.online).map(d=>({name:d.name,kind:d.kind,capabilities:d.capabilities})), localTime:new Date().toISOString(), page:document.visibilityState, voiceRequest };
    const data = await api('/api/chat',{method:'POST',body:JSON.stringify({message:text,conversationId:state.conversationId,deviceId:state.deviceId,settings:state.settings,context})});
    addAssistantReply(data.reply,{speakNow:voiceRequest,memorySaved:data.memorySaved,deviceId:data.workspaceAction?'google-workspace':data.whatsappAction?'whatsapp-evolution':'cloud-core'});
    if(data.memorySaved) toast('Memória guardada','Isso vai acompanhar você entre dispositivos.','success');
    if(data.action) toast('Ação enviada',`${data.action.target}: ${data.action.action}`,'success');
    if(data.workspaceAction) toast('Google Workspace',`${data.workspaceAction.action} concluído pela API do Google.`,'success');
    if(data.needsGoogleConnect){ showView('integrations'); loadGoogleStatus(); }
    if(data.needsEvolutionConnect){ showView('integrations'); loadEvolutionStatus(); }
    if(data.whatsappAction) toast('WhatsApp','Mensagem confirmada pela Evolution API.','success');
    setTimeout(()=>sync({silent:true}),350);
  } catch(error) {
    toast('A Sexta tropeçou',error.message,'error');
    const fallback='Tive um problema para responder. Meus comandos locais continuam funcionando.';
    addAssistantReply(fallback,{speakNow:voiceRequest,deviceId:'local-error'});
  }
  finally { state.busy=false; $('#thinking').classList.add('hidden'); $('#sendBtn').disabled=false; }
}

async function addMemory(content) { try { await api('/api/memory',{method:'POST',body:JSON.stringify({content,kind:'fact',importance:.75})}); toast('Guardado','Essa memória entrou no contexto e no Vault Markdown.','success'); await sync({silent:true}); await syncObsidianVault({silent:true}); } catch(e){toast('Não consegui guardar',e.message,'error')} }
async function removeMemory(id) { if(!confirm('Apagar esta memória permanente?')) return; try{await api('/api/memory',{method:'DELETE',body:JSON.stringify({id})});await sync({silent:true});await syncObsidianVault({silent:true})}catch(e){toast('Falha ao apagar',e.message,'error')} }
async function saveSettings(){ state.settings=readSettingsUI(); try{const d=await api('/api/settings',{method:'POST',body:JSON.stringify(state.settings)});state.settings={...defaults,...d.settings};applySettingsUI();toast('Personalidade atualizada','O próximo turno já usa esses ajustes.','success')}catch(e){toast('Falha ao salvar',e.message,'error')} }
async function command(action,payload={}) { try{const d=await api('/api/commands',{method:'POST',body:JSON.stringify({action,payload})});toast('Enviado para o PC',`${action} entrou na fila.`,'success');return d}catch(e){toast('PC indisponível',e.message==='no_desktop_online'?'Nenhum agente Windows está online.':e.message,'error')} }

let recognition = null;
function speechRecognitionCtor(){return window.SpeechRecognition||window.webkitSpeechRecognition}
function startVoiceOnce(){
  const C=speechRecognitionCtor(); if(!C) return toast('Voz indisponível','Este navegador não expõe reconhecimento de fala.','error');
  if(recognition) try{recognition.abort()}catch{}
  recognition=new C(); recognition.lang='pt-BR'; recognition.interimResults=false; recognition.continuous=false;
  $('#voiceBtn').classList.add('active'); $('#voiceHint').textContent='ouvindo...';
  recognition.onresult=e=>{const text=e.results[e.results.length-1][0].transcript;$('#messageInput').value=text;resizeInput();sendMessage(text,{voiceRequest:true});$('#messageInput').value='';resizeInput()};
  recognition.onerror=e=>toast('Microfone',e.error||'Não consegui ouvir.','error');
  recognition.onend=()=>{$('#voiceBtn').classList.remove('active');$('#voiceHint').textContent=state.wakeActive?'aguardando “Sexta-feira”':'Voz pronta';recognition=null};
  recognition.start();
}
function toggleWake(){
  const C=speechRecognitionCtor(); if(!C)return toast('Wake word indisponível','O navegador não oferece reconhecimento contínuo.','error');
  state.wakeActive=!state.wakeActive;$('#wakeBtn').classList.toggle('active',state.wakeActive);$('#voiceHint').textContent=state.wakeActive?'aguardando “Sexta-feira”':'Voz pronta';
  if(!state.wakeActive){if(recognition)try{recognition.abort()}catch{};return}
  const run=()=>{ if(!state.wakeActive)return; recognition=new C();recognition.lang='pt-BR';recognition.continuous=true;recognition.interimResults=false;
    recognition.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){if(!e.results[i].isFinal)continue;const phrase=e.results[i][0].transcript.trim();const match=phrase.match(/\bsexta(?:[- ]feira)?\b[,: ]*(.*)$/i);if(match){const rest=(match[1]||'').trim();if(rest)sendMessage(rest,{voiceRequest:true});else { speak('Estou ouvindo.'); toast('Estou ouvindo','Diga o pedido depois de “Sexta-feira”.') }}}};
    recognition.onend=()=>{recognition=null;if(state.wakeActive)setTimeout(run,350)};recognition.onerror=()=>{};try{recognition.start()}catch{setTimeout(run,700)} };
  run();
}
function pickPortugueseVoice(){
  const voices=speechSynthesis.getVoices();
  const pt=voices.filter(v=>v.lang?.toLowerCase().startsWith('pt'));
  return pt.find(v=>/francisca|maria|luciana|female|femin/i.test(v.name)) || pt.find(v=>v.lang?.toLowerCase()==='pt-br') || pt[0] || null;
}
function prepareVoice(){ if(!('speechSynthesis'in window))return; try{speechSynthesis.resume();speechSynthesis.getVoices()}catch{} }
function speak(text){
  if(!('speechSynthesis'in window)||state.settings.voice===false)return;
  prepareVoice();
  speechSynthesis.cancel();
  const clean=String(text).replace(/```[\s\S]*?```/g,' código ').replace(/[`*_#]/g,'').replace(/https?:\/\/\S+/g,'link').trim();
  if(!clean)return;
  const u=new SpeechSynthesisUtterance(clean);u.lang='pt-BR';u.rate=1.06;u.pitch=1.02;u.voice=pickPortugueseVoice();
  u.onerror=()=>{$('#voiceHint').textContent=state.wakeActive?'aguardando “Sexta-feira”':'Voz pronta'};
  speechSynthesis.speak(u);
}
if('speechSynthesis'in window) window.speechSynthesis.onvoiceschanged=()=>speechSynthesis.getVoices();
function resizeInput(){const t=$('#messageInput');t.style.height='auto';t.style.height=Math.min(t.scrollHeight,140)+'px'}

function bind() {
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  $('#syncBtn').onclick=()=>sync(); $('#handoffDismiss').onclick=()=>$('#handoffBanner').classList.add('hidden');
  $('#composer').addEventListener('submit',e=>{e.preventDefault();const t=$('#messageInput');const text=t.value;t.value='';resizeInput();sendMessage(text)});
  $('#messageInput').addEventListener('input',resizeInput); $('#messageInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#composer').requestSubmit()}});
  $$('.quick-actions [data-prompt]').forEach(b=>b.onclick=()=>sendMessage(b.dataset.prompt));
  $('[data-command="system-info"]').onclick=()=>command('get_system_info',{});
  $$('.context-action').forEach(b=>b.onclick=()=>command(b.dataset.action,JSON.parse(b.dataset.payload||'{}')));
  $('#voiceBtn').onclick=()=>{prepareVoice();startVoiceOnce()}; $('#wakeBtn').onclick=()=>{prepareVoice();toggleWake()};
  $('#addMemoryBtn').onclick=()=>{$('#memoryInput').value='';$('#memoryDialog').showModal()};
  $('#vaultChooseBtn').onclick=chooseVaultFolder; $('#vaultSyncBtn').onclick=()=>syncObsidianVault(); $('#vaultOpenBtn').onclick=openObsidianVault;
  $('#memoryForm').addEventListener('submit',e=>{e.preventDefault();const v=$('#memoryInput').value.trim();if(v){$('#memoryDialog').close();addMemory(v)}});
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();try{await login($('#pinInput').value);$('#loginError').classList.add('hidden');await heartbeat();await sync({silent:true})}catch{$('#loginError').classList.remove('hidden')}});
  $('#saveSettingsBtn').onclick=saveSettings;
  $('#googleConnectBtn').onclick=connectGoogle; $('#googleTestBtn').onclick=testGoogleCalendar;
  $('#evolutionWebhookBtn').onclick=configureEvolution; $('#evolutionTestBtn').onclick=testEvolution;
  $('#notificationPermissionBtn').onclick=enableDeviceNotifications; $('#enableNotificationsBtn').onclick=enableDeviceNotifications; $('#notificationMonitorBtn').onclick=runNotificationMonitor; $('#runMonitorBtn').onclick=runNotificationMonitor;
  $('#chatgptOpenBtn').onclick=()=>{window.open('https://chatgpt.com/','_blank','noopener,noreferrer');toast('ChatGPT','Aberto em uma nova aba.','success')}; $('#chatgptImportBtn').onclick=importChatGPTResponse;
  ['Humor','Sarcasm','Proactivity','Verbosity','Confidence','Formality','Warmth','NotificationThreshold'].forEach(k=>{$(`#setting${k}`).addEventListener('input',e=>{e.target.nextElementSibling.textContent=e.target.value;updatePersonalityPreview()})});
  $('#settingName').addEventListener('input',updatePersonalityPreview);$('#settingVoice').addEventListener('change',updatePersonalityPreview);$('#settingAutoSpeak').addEventListener('change',updatePersonalityPreview);$('#settingSpeakNotifications').addEventListener('change',updatePersonalityPreview);$('#settingWhatsappNotifyAll').addEventListener('change',updatePersonalityPreview);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){heartbeat();sync({silent:true})}});
}

async function bootstrap(){
  bind(); updateContext(); renderMessages(); renderNotifications(); notificationPermissionUI();
  const qp=new URLSearchParams(location.search); if(qp.get('google')==='connected'){toast('Google Workspace','Conta conectada com sucesso.','success');history.replaceState({},'',location.pathname)} else if(qp.get('google')==='error'){toast('Google OAuth',qp.get('reason')||'Falha ao conectar.','error');history.replaceState({},'',location.pathname)}
  if('serviceWorker'in navigator) navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
  try{state.health=await (await fetch('/api/health')).json();setHealthUI()}catch{state.health={cloud:false,ai:'demo',authRequired:false,model:'offline'};setHealthUI();toast('Servidor offline','A interface abriu, mas o core não respondeu.','error');return}
  try{
    if(!state.token){ if(state.health.authRequired){showLogin();return}else await login('') }
    await heartbeat(); await sync({silent:true}); await Promise.all([loadGoogleStatus(),loadEvolutionStatus(),loadVault({silent:true})]);
  }catch(e){ if(state.health.authRequired)showLogin(); else toast('Inicialização parcial',e.message,'error') }
  setInterval(heartbeat,15000);setInterval(()=>sync({silent:true}),5000);
}
bootstrap();
