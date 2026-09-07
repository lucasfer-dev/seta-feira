(() => {
  const chatStage = document.querySelector('#view-chat .chat-stage');
  if (!chatStage) return;

  document.body.classList.remove('sexta-v2', 'sexta-panel-open', 'sexta-voice-first', 'manual-chat-open');
  document.body.classList.add('sexta-v3');
  document.body.dataset.voiceState = 'off';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia.' : hour < 18 ? 'Boa tarde.' : 'Boa noite.';
  const token = () => localStorage.getItem('sexta_token') || '';
  const authHeaders = () => ({ 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const shell = document.createElement('div');
  shell.className = 'sexta-v3-home';
  shell.innerHTML = `
    <div class="s3-gridlines" aria-hidden="true"></div>
    <header class="s3-top">
      <div class="s3-brand"><span class="s3-brand-mark"></span><div class="s3-brand-copy"><strong>SEXTA</strong><small>PERSONAL INTELLIGENCE // CORE 03</small></div></div>
      <div class="s3-top-status">
        <span class="s3-chip" id="s3CloudChip"><i></i><b>CLOUD</b><span>CHECK</span></span>
        <span class="s3-chip ok" id="s3VoiceChip"><i></i><b>VOICE</b><span>V10</span></span>
        <span class="s3-chip" id="s3AgentChip"><i></i><b>PC AGENT</b><span>OFFLINE</span></span>
      </div>
      <div class="s3-top-actions">
        <button class="s3-text-btn" type="button" id="s3AgentBtn">AGENTE</button>
        <button class="s3-icon-btn" type="button" id="s3RefreshBtn" title="Atualizar telemetria">↻</button>
      </div>
    </header>

    <main class="s3-stage">
      <aside class="s3-rail left">
        <div class="s3-section-label">System telemetry</div>
        <section class="s3-panel">
          <div class="s3-panel-head"><strong>CORE STATUS</strong><span>LIVE</span></div>
          <div class="s3-metric"><label>Cloud brain</label><b id="s3Brain">CHECK</b></div>
          <div class="s3-metric"><label>Voice pipeline</label><b>GEMINI LIVE // V10</b></div>
          <div class="s3-metric"><label>Memórias</label><b id="s3MemoryCount">—</b></div>
          <div class="s3-metric"><label>Dispositivos</label><b id="s3DeviceCount">—</b></div>
        </section>
        <section class="s3-panel amber s3-agent-card" id="s3AgentCard" tabindex="0" role="button" aria-label="Abrir controles do PC Agent">
          <div class="s3-panel-head"><strong>WINDOWS BODY</strong><span id="s3AgentVersion">NOT PAIRED</span></div>
          <div class="s3-agent-state"><div class="s3-agent-core"><i></i></div><div class="s3-agent-copy"><strong id="s3AgentName">Nenhum PC conectado</strong><small id="s3AgentMode">Pareie para liberar Vision + Hands</small></div></div>
        </section>
      </aside>

      <section class="s3-core">
        <div class="s3-reactor-wrap" aria-label="Núcleo de presença da SEXTA">
          <span class="s3-ring r1"></span><span class="s3-ring r2"></span><span class="s3-ring r3"></span>
          <button type="button" class="s3-reactor" id="s3Reactor" aria-label="Iniciar ou encerrar conversa por voz"><span class="s3-eye"></span></button>
        </div>
        <div class="s3-core-tag">SEXTA // ONLINE PRESENCE</div>
        <h1 class="s3-greeting">${greeting}</h1>
        <p class="s3-status" id="s3VoiceStatus">Pronta para conversar.</p>
        <div class="s3-transcript" id="s3Transcript" aria-live="polite"><span class="ghost">A transcrição aparece aqui enquanto você fala.</span></div>
        <div class="s3-actions">
          <button type="button" class="s3-primary" id="s3VoicePrimary">INICIAR CONVERSA</button>
          <button type="button" class="s3-secondary" id="s3ManualChat">CHAT MANUAL</button>
        </div>
      </section>

      <aside class="s3-rail right">
        <div class="s3-section-label">Active operations</div>
        <section class="s3-panel">
          <div class="s3-panel-head"><strong>QUICK COMMANDS</strong><span>TOOLS</span></div>
          <div class="s3-quick">
            <button data-s3-prompt="Sexta, olha minha tela e me diz o que está acontecendo."><strong>PC VISION</strong><small>olhar tela</small></button>
            <button data-s3-prompt="Sexta, quais janelas estão abertas no meu computador?"><strong>WINDOWS</strong><small>listar janelas</small></button>
            <button data-s3-prompt="Sexta, me diga o status do meu computador."><strong>STATUS</strong><small>sistema</small></button>
            <button data-s3-prompt="Sexta, o que você lembra sobre o que estamos fazendo agora?"><strong>CONTEXT</strong><small>memória ativa</small></button>
          </div>
        </section>
        <section class="s3-panel amber">
          <div class="s3-panel-head"><strong>SAFETY LAYER</strong><span>POLICY</span></div>
          <div class="s3-metric"><label>Autonomia</label><b class="amber" id="s3Autonomy">ASSISTANT</b></div>
          <div class="s3-metric"><label>Kill switch</label><b id="s3PauseState">READY</b></div>
          <div class="s3-metric"><label>Privacy</label><b id="s3PrivacyState">LOCAL</b></div>
        </section>
      </aside>
    </main>

    <nav class="s3-dock" aria-label="Navegação da SEXTA">
      <button class="active" type="button" data-s3-home title="Conversa"><span>CORE</span> ◉</button>
      <button type="button" data-s3-view="memory" title="Memória"><span>MEM</span> ⌁</button>
      <button type="button" data-s3-view="devices" title="Dispositivos"><span>DEV</span> ⌘</button>
      <button type="button" data-s3-view="activity" title="Atividade"><span>LOG</span> ↗</button>
      <button type="button" data-s3-view="integrations" title="Integrações"><span>LINK</span> ∞</button>
      <button type="button" data-s3-view="settings" title="Personalidade"><span>DNA</span> ⚙</button>
    </nav>
  `;
  chatStage.insertBefore(shell, chatStage.firstChild);

  const returnBtn = document.createElement('button');
  returnBtn.className = 's3-return'; returnBtn.type = 'button'; returnBtn.textContent = '← VOLTAR AO CORE';
  document.body.append(returnBtn);

  const modal = document.createElement('dialog');
  modal.className = 's3-agent-modal';
  modal.innerHTML = `
    <div class="s3-modal-shell">
      <div class="s3-modal-top"><div><p>WINDOWS BODY // CONTROL CENTER</p><h2>PC Agent</h2></div><button class="s3-modal-close" type="button">×</button></div>
      <div class="s3-modal-grid">
        <section class="s3-control-card full">
          <h3>FIRST CONTACT // PAIRING</h3><p>Rode <code>npm run sexta:setup</code> no PC e informe o código temporário abaixo. Ele não é o token do agente e expira rapidamente.</p>
          <div class="s3-pair-code"><span id="s3PairCode">••••-••••</span><button class="s3-control-button" type="button" id="s3PairReveal">GERAR CÓDIGO</button></div>
          <p id="s3PairExpiry" style="margin-top:8px;margin-bottom:0">O código só aparece quando você solicitar.</p>
        </section>
        <section class="s3-control-card">
          <h3>AUTONOMY LEVEL</h3><p>Observador só lê. Assistente executa ações pontuais. Autônomo libera tarefas observe → act → verify.</p>
          <div class="s3-segment" id="s3AutonomyButtons"><button data-value="observer">OBS</button><button data-value="assistant">ASSIST</button><button data-value="autonomous">AUTO</button></div>
        </section>
        <section class="s3-control-card">
          <h3>KILL SWITCH</h3><p>Pausa novas ações sem derrubar heartbeat e canal de controle. Cancelar encerra processos rastreados como Codex.</p>
          <div class="s3-segment"><button id="s3PauseBtn">PAUSAR</button><button id="s3CancelBtn" class="danger">CANCELAR TAREFA</button></div>
        </section>
        <section class="s3-control-card full">
          <h3>PRIVACY MODE</h3><p>Cada sensor pode ser desligado localmente. A cloud continua conversando mesmo com olhos e mãos privados.</p>
          <div class="s3-control-row"><label>Captura de tela / Vision</label><input class="s3-switch" type="checkbox" data-privacy="screen"></div>
          <div class="s3-control-row"><label>Clipboard</label><input class="s3-switch" type="checkbox" data-privacy="clipboard"></div>
          <div class="s3-control-row"><label>Windows UI Automation</label><input class="s3-switch" type="checkbox" data-privacy="uiAutomation"></div>
          <div class="s3-control-row"><label>Browser Agent</label><input class="s3-switch" type="checkbox" data-privacy="browser"></div>
        </section>
        <section class="s3-control-card full">
          <h3>STATUS</h3><p id="s3ModalStatus">Nenhum PC Agent online. Depois do setup, o estado aparece aqui em tempo real.</p>
        </section>
      </div>
    </div>`;
  document.body.append(modal);

  const $ = selector => document.querySelector(selector);
  const state = { voice: 'off', agent: null, sync: null, health: null };
  const labels = {
    off:['Pronta para conversar.','INICIAR CONVERSA'], connecting:['Conectando ao Voice Core...','CONECTANDO...'],
    listening:['Ouvindo.','ENCERRAR CONVERSA'], user_speaking:['Ouvindo você.','ENCERRAR CONVERSA'], thinking:['Processando contexto...','ENCERRAR CONVERSA'],
    speaking:['Respondendo.','ENCERRAR CONVERSA'], tool:['Executando uma ação...','ENCERRAR CONVERSA'], recovering:['Recuperando sessão...','RECONECTANDO...'], error:['Falha no canal de voz.','TENTAR NOVAMENTE']
  };

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }

  function chip(el, status, text) {
    if (!el) return; el.classList.remove('ok','warn','error'); if (status) el.classList.add(status); const span = el.querySelector('span'); if (span) span.textContent = text;
  }

  function renderVoice(detail = {}) {
    const voice = detail.state || 'off'; state.voice = voice; document.body.dataset.voiceState = voice;
    const [status, button] = labels[voice] || labels.off;
    $('#s3VoiceStatus').textContent = detail.label || status; $('#s3VoicePrimary').textContent = button;
    chip($('#s3VoiceChip'), voice === 'error' ? 'error' : voice === 'off' ? 'ok' : 'ok', voice === 'off' ? 'V10 READY' : voice.toUpperCase().replace('_',' '));
  }

  function renderTranscript(detail = {}) {
    const text = String(detail.interim || detail.final || '').trim(); const box = $('#s3Transcript');
    if (!text) { box.classList.remove('has-text'); box.innerHTML = '<span class="ghost">A transcrição aparece aqui enquanto você fala.</span>'; return; }
    box.classList.add('has-text'); box.textContent = text;
  }

  function toggleVoice() { const live = window.__sextaGeminiLive; if (!live) return; live.active?.() ? live.stop?.() : live.start?.(); }
  function runPrompt(text) { const input = $('#messageInput'); const form = $('#composer'); if (!input || !form) return; input.value = text; input.dispatchEvent(new Event('input',{bubbles:true})); form.requestSubmit?.(); }

  function renderAgent() {
    const agent = state.agent; const ctx = agent?.context || {};
    if (!agent) {
      chip($('#s3AgentChip'), 'warn', 'OFFLINE'); $('#s3AgentName').textContent = 'Nenhum PC conectado'; $('#s3AgentMode').textContent = 'Pareie para liberar Vision + Hands';
      $('#s3AgentVersion').textContent = 'NOT PAIRED'; $('#s3Autonomy').textContent = '—'; $('#s3PauseState').textContent = 'OFFLINE'; $('#s3PrivacyState').textContent = '—';
      $('#s3ModalStatus').textContent = 'Nenhum PC Agent online. Depois do setup, o estado aparece aqui em tempo real.'; return;
    }
    chip($('#s3AgentChip'), ctx.paused ? 'warn' : 'ok', ctx.paused ? 'PAUSED' : 'ONLINE');
    $('#s3AgentName').textContent = agent.name || agent.device_id; $('#s3AgentMode').textContent = `${ctx.autonomy || 'assistant'} • ${ctx.pcVision ? 'vision' : 'sem vision'} • ${ctx.pcHands ? 'hands' : 'sem hands'}`;
    $('#s3AgentVersion').textContent = `V${ctx.agentVersion || ctx.agentProtocol || '?'}`; $('#s3Autonomy').textContent = String(ctx.autonomy || 'assistant').toUpperCase(); $('#s3PauseState').textContent = ctx.paused ? 'PAUSED' : 'READY';
    const privacy = ctx.privacy || {}; const enabled = ['screen','clipboard','uiAutomation','browser'].filter(key => privacy[key] !== false).length; $('#s3PrivacyState').textContent = `${enabled}/4 ON`;
    $('#s3ModalStatus').textContent = `${agent.name || 'PC'} • ${ctx.paused ? 'pausado' : 'ativo'} • autonomia ${ctx.autonomy || 'assistant'} • protocolo ${ctx.agentProtocol || '?'}`;
    document.querySelectorAll('[data-privacy]').forEach(input => { input.checked = privacy[input.dataset.privacy] !== false; });
    document.querySelectorAll('#s3AutonomyButtons button').forEach(btn => btn.classList.toggle('active', btn.dataset.value === (ctx.autonomy || 'assistant')));
    $('#s3PauseBtn').textContent = ctx.paused ? 'RETOMAR' : 'PAUSAR';
  }

  async function refreshTelemetry(force = false) {
    try {
      const health = await fetch('/api/health').then(r => r.json()); state.health = health; $('#s3Brain').textContent = health.ai === 'gemini' ? 'GEMINI ONLINE' : 'DEMO'; chip($('#s3CloudChip'), health.cloud ? 'ok' : 'warn', health.cloud ? 'SYNCED' : 'LOCAL');
    } catch { chip($('#s3CloudChip'),'error','OFFLINE'); }
    if (!token()) { renderAgent(); return; }
    try {
      const sync = await api(`/api/sync${force ? '?fresh=1' : ''}`); state.sync = sync; $('#s3MemoryCount').textContent = String(sync.memories?.length ?? 0).padStart(2,'0'); $('#s3DeviceCount').textContent = String(sync.devices?.filter(d=>d.online).length ?? 0).padStart(2,'0');
      state.agent = (sync.devices || []).find(d => d.online && (d.context?.pcAgent || d.kind === 'agent')) || null; renderAgent();
    } catch { state.agent = null; renderAgent(); }
  }

  async function agentControl(op, value) {
    if (!state.agent) throw new Error('Nenhum PC Agent online');
    await api('/api/agent-control', { method:'POST', body:JSON.stringify({ op, value, targetDeviceId: state.agent.device_id }) });
    $('#s3ModalStatus').textContent = 'Comando enviado. Aguardando heartbeat do PC...'; setTimeout(() => refreshTelemetry(true), 1100);
  }

  async function revealPairCode() {
    const button = $('#s3PairReveal'); button.disabled = true;
    try {
      const data = await api('/api/agent-pair'); $('#s3PairCode').textContent = data.code; const seconds = Math.max(1, Math.floor((data.expiresInMs || 0)/1000)); $('#s3PairExpiry').textContent = `Expira em aproximadamente ${seconds}s. Use no npm run sexta:setup.`;
    } catch (error) { $('#s3PairCode').textContent = 'ERRO'; $('#s3PairExpiry').textContent = error.message; }
    finally { button.disabled = false; }
  }

  function openAgentModal() { modal.showModal?.(); refreshTelemetry(true); }
  function openLegacy(view) {
    document.body.classList.add('sexta-v3-panel-open');
    const nav = document.querySelector(`.nav-item[data-view="${view}"]`) || document.querySelector(`.mobile-nav [data-view="${view}"]`); nav?.click();
  }
  function closeLegacy() { document.body.classList.remove('sexta-v3-panel-open'); document.querySelector('.nav-item[data-view="chat"]')?.click(); }

  $('#s3Reactor').addEventListener('click', toggleVoice); $('#s3VoicePrimary').addEventListener('click', toggleVoice);
  $('#s3ManualChat').addEventListener('click', () => { const open = !document.body.classList.contains('sexta-manual-chat'); document.body.classList.toggle('sexta-manual-chat', open); $('#s3ManualChat').textContent = open ? 'FECHAR CHAT' : 'CHAT MANUAL'; if(open) setTimeout(()=>$('#messageInput')?.focus(),60); });
  $('#s3RefreshBtn').addEventListener('click', () => refreshTelemetry(true)); $('#s3AgentBtn').addEventListener('click', openAgentModal); $('#s3AgentCard').addEventListener('click', openAgentModal); $('#s3AgentCard').addEventListener('keydown', e => { if(['Enter',' '].includes(e.key)){e.preventDefault();openAgentModal();} });
  modal.querySelector('.s3-modal-close').addEventListener('click', () => modal.close()); $('#s3PairReveal').addEventListener('click', revealPairCode);
  $('#s3PauseBtn').addEventListener('click', async () => { try { await agentControl(state.agent?.context?.paused ? 'resume' : 'pause'); } catch(e){ $('#s3ModalStatus').textContent=e.message; } });
  $('#s3CancelBtn').addEventListener('click', async () => { try { await agentControl('cancel'); } catch(e){ $('#s3ModalStatus').textContent=e.message; } });
  document.querySelectorAll('#s3AutonomyButtons button').forEach(btn => btn.addEventListener('click', async () => { try { await agentControl('set_autonomy', btn.dataset.value); } catch(e){ $('#s3ModalStatus').textContent=e.message; } }));
  document.querySelectorAll('[data-privacy]').forEach(input => input.addEventListener('change', async () => { try { await agentControl('set_privacy', { [input.dataset.privacy]: input.checked }); } catch(e){ input.checked=!input.checked; $('#s3ModalStatus').textContent=e.message; } }));
  document.querySelectorAll('[data-s3-prompt]').forEach(btn => btn.addEventListener('click', () => runPrompt(btn.dataset.s3Prompt)));
  document.querySelectorAll('[data-s3-view]').forEach(btn => btn.addEventListener('click', () => openLegacy(btn.dataset.s3View))); document.querySelector('[data-s3-home]').addEventListener('click', closeLegacy); returnBtn.addEventListener('click', closeLegacy);

  window.addEventListener('sexta:voice-state', event => renderVoice(event.detail || {})); window.addEventListener('sexta:voice-transcript', event => renderTranscript(event.detail || {}));
  window.addEventListener('focus', () => refreshTelemetry(false));
  renderVoice({ state:'off' }); refreshTelemetry(true); setInterval(() => refreshTelemetry(false), 12000);

  window.__sextaV3 = { refresh: () => refreshTelemetry(true), openAgent: openAgentModal, state: () => ({ voice:state.voice, agent:state.agent, health:state.health }) };
})();
