(() => {
  if (!document.body.classList.contains('sexta-v4') || window.__sextaV4System) return;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const token = () => localStorage.getItem('sexta_token') || '';
  const headers = () => ({ 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  const sensitive = /SENSITIVE|PASSWORD|USER_ACTION|CONFIRM|PAY|PAGAR|COMPRAR|TRANSFER|EXCLUIR|DELETE|ENVIAR|PUBLICAR|IRREVERS/i;
  let snapshot = null;
  let agent = null;

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }

  const panel = document.createElement('div');
  panel.className = 's4-system-sheet hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Controle técnico da Sexta');
  panel.innerHTML = `
    <button class="s4-system-backdrop" type="button" aria-label="Fechar painel técnico"></button>
    <section class="s4-system-panel">
      <header class="s4-system-head">
        <div><p>CONTROLE LOCAL</p><h2>PC Agent</h2><span id="s4AgentPanelStatus">Verificando agente...</span></div>
        <button type="button" class="s4-system-close" aria-label="Fechar">×</button>
      </header>
      <div class="s4-system-grid">
        <article class="s4-system-card full">
          <div class="s4-system-card-head"><strong>PAREAMENTO</strong><span id="s4AgentVersion">—</span></div>
          <p>Gere um código temporário somente quando precisar conectar ou reconectar um PC.</p>
          <div class="s4-pair-row"><code id="s4PairCode">••••-••••</code><button type="button" id="s4PairBtn">GERAR CÓDIGO</button></div>
          <small id="s4PairHint">O código expira rapidamente e não é o token do agente.</small>
        </article>
        <article class="s4-system-card">
          <div class="s4-system-card-head"><strong>AUTONOMIA</strong><span id="s4AutonomyLabel">—</span></div>
          <div class="s4-segments" id="s4AutonomyButtons">
            <button type="button" data-value="observer">OBS</button>
            <button type="button" data-value="assistant">ASSIST</button>
            <button type="button" data-value="autonomous">AUTO</button>
          </div>
          <small>Observer lê. Assistant age pontualmente. Auto permite observe → act → verify.</small>
        </article>
        <article class="s4-system-card">
          <div class="s4-system-card-head"><strong>INTERRUPÇÃO</strong><span id="s4PauseLabel">READY</span></div>
          <div class="s4-segments">
            <button type="button" id="s4PauseBtn">PAUSAR</button>
            <button type="button" id="s4CancelBtn" class="danger">CANCELAR</button>
          </div>
          <small>O kill switch pausa novas ações sem derrubar o canal de controle.</small>
        </article>
        <article class="s4-system-card full">
          <div class="s4-system-card-head"><strong>PRIVACIDADE LOCAL</strong><span id="s4PrivacyLabel">—</span></div>
          <label class="s4-toggle-row"><span><b>Vision</b><small>captura de tela</small></span><input type="checkbox" data-s4-privacy="screen"></label>
          <label class="s4-toggle-row"><span><b>Clipboard</b><small>área de transferência</small></span><input type="checkbox" data-s4-privacy="clipboard"></label>
          <label class="s4-toggle-row"><span><b>UI Automation</b><small>controles do Windows</small></span><input type="checkbox" data-s4-privacy="uiAutomation"></label>
          <label class="s4-toggle-row"><span><b>Browser Agent</b><small>automação do navegador</small></span><input type="checkbox" data-s4-privacy="browser"></label>
        </article>
        <article class="s4-system-card full">
          <div class="s4-system-card-head"><strong>DECISION GATE</strong><button type="button" id="s4DecisionActivity">ABRIR LOG</button></div>
          <div id="s4DecisionList" class="s4-decision-list"><p>Nenhuma decisão sensível recente.</p></div>
          <small>Ações financeiras, destrutivas ou irreversíveis continuam exigindo confirmação.</small>
        </article>
      </div>
    </section>`;
  document.body.append(panel);

  function clean(value) {
    return String(value ?? '').replace(/[<>]/g, '').slice(0, 320);
  }

  function render() {
    const ctx = agent?.context || {};
    const status = $('#s4AgentPanelStatus');
    if (!agent) {
      status.textContent = 'Nenhum PC Agent online.';
      $('#s4AgentVersion').textContent = 'OFFLINE';
      $('#s4AutonomyLabel').textContent = '—';
      $('#s4PauseLabel').textContent = 'OFFLINE';
      $('#s4PrivacyLabel').textContent = '—';
      $$('#s4AutonomyButtons button').forEach(button => button.classList.remove('active'));
      $$('[data-s4-privacy]').forEach(input => { input.checked = false; input.disabled = true; });
    } else {
      status.textContent = `${agent.name || 'PC'} • ${ctx.paused ? 'pausado' : 'ativo'}`;
      $('#s4AgentVersion').textContent = `V${ctx.agentVersion || ctx.agentProtocol || '?'}`;
      $('#s4AutonomyLabel').textContent = String(ctx.autonomy || 'assistant').toUpperCase();
      $('#s4PauseLabel').textContent = ctx.paused ? 'PAUSED' : 'READY';
      $('#s4PauseBtn').textContent = ctx.paused ? 'RETOMAR' : 'PAUSAR';
      $$('#s4AutonomyButtons button').forEach(button => button.classList.toggle('active', button.dataset.value === (ctx.autonomy || 'assistant')));
      const privacy = ctx.privacy || {};
      const enabled = ['screen','clipboard','uiAutomation','browser'].filter(key => privacy[key] !== false).length;
      $('#s4PrivacyLabel').textContent = `${enabled}/4 ON`;
      $$('[data-s4-privacy]').forEach(input => {
        input.disabled = false;
        input.checked = privacy[input.dataset.s4Privacy] !== false;
      });
    }

    const matches = (snapshot?.events || []).filter(event => sensitive.test(
      `${event.title || ''} ${event.body || ''} ${event.message || ''} ${JSON.stringify(event.metadata || {})}`
    )).slice(0, 4);
    const list = $('#s4DecisionList');
    list.innerHTML = matches.length
      ? matches.map(event => `<article><strong>${clean(event.title || event.action || 'Ação interrompida')}</strong><small>${clean(event.body || event.message || 'A Sexta parou antes da etapa final.')}</small></article>`).join('')
      : '<p>Nenhuma decisão sensível recente.</p>';
  }

  async function refresh() {
    if (!token()) {
      snapshot = null;
      agent = null;
      render();
      return;
    }
    try {
      snapshot = await api('/api/sync?fresh=1');
      agent = (snapshot.devices || []).find(device => device.online && (device.context?.pcAgent || device.kind === 'agent')) || null;
    } catch {
      snapshot = null;
      agent = window.__sextaV4?.state?.().agent || null;
    }
    render();
  }

  async function control(op, value) {
    if (!agent) throw new Error('Nenhum PC Agent online');
    await api('/api/agent-control', { method:'POST', body:JSON.stringify({ op, value, targetDeviceId:agent.device_id }) });
    $('#s4AgentPanelStatus').textContent = 'Comando enviado. Atualizando estado...';
    setTimeout(() => void refresh(), 900);
  }

  async function pair() {
    const button = $('#s4PairBtn');
    button.disabled = true;
    try {
      const data = await api('/api/agent-pair');
      $('#s4PairCode').textContent = data.code || '—';
      const seconds = Math.max(1, Math.floor((data.expiresInMs || 0) / 1000));
      $('#s4PairHint').textContent = `Expira em aproximadamente ${seconds}s. Use no setup local do PC Agent.`;
    } catch (error) {
      $('#s4PairCode').textContent = 'ERRO';
      $('#s4PairHint').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function open() {
    document.querySelector('.s4-palette')?.classList.add('hidden');
    document.body.classList.remove('sexta-v4-palette-open');
    panel.classList.remove('hidden');
    document.body.classList.add('sexta-v4-system-open');
    await refresh();
  }

  function close() {
    panel.classList.add('hidden');
    document.body.classList.remove('sexta-v4-system-open');
  }

  function installDockButton() {
    const dock = $('.s4-dock');
    if (!dock || $('[data-s4-system]', dock)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.s4System = '';
    button.title = 'Controle do PC Agent';
    button.innerHTML = '<span>◇</span><small>Controle</small>';
    const settings = $('[data-s4-view="settings"]', dock);
    dock.insertBefore(button, settings || null);
    button.addEventListener('click', () => void open());
  }

  function installPaletteCommand() {
    const list = $('#s4CommandList');
    if (!list || $('[data-s4-system-command]', list)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 's4-command-item s4-system-command';
    button.dataset.s4SystemCommand = '';
    button.innerHTML = '<span class="s4-command-icon">◇</span><span><strong>Controle do PC Agent</strong><small>Autonomia, privacidade, pareamento e kill switch</small></span><kbd>↵</kbd>';
    button.addEventListener('click', () => void open());
    list.append(button);
  }

  $('.s4-system-backdrop', panel).addEventListener('click', close);
  $('.s4-system-close', panel).addEventListener('click', close);
  $('#s4PairBtn').addEventListener('click', pair);
  $('#s4PauseBtn').addEventListener('click', async () => {
    try { await control(agent?.context?.paused ? 'resume' : 'pause'); }
    catch (error) { $('#s4AgentPanelStatus').textContent = error.message; }
  });
  $('#s4CancelBtn').addEventListener('click', async () => {
    try { await control('cancel'); }
    catch (error) { $('#s4AgentPanelStatus').textContent = error.message; }
  });
  $$('#s4AutonomyButtons button').forEach(button => button.addEventListener('click', async () => {
    try { await control('set_autonomy', button.dataset.value); }
    catch (error) { $('#s4AgentPanelStatus').textContent = error.message; }
  }));
  $$('[data-s4-privacy]').forEach(input => input.addEventListener('change', async () => {
    try { await control('set_privacy', { [input.dataset.s4Privacy]:input.checked }); }
    catch (error) { input.checked = !input.checked; $('#s4AgentPanelStatus').textContent = error.message; }
  }));
  $('#s4DecisionActivity').addEventListener('click', () => {
    close();
    document.body.classList.add('sexta-v4-panel-open');
    $('.nav-item[data-view="activity"]')?.click();
  });

  const observer = new MutationObserver(() => {
    installDockButton();
    installPaletteCommand();
  });
  observer.observe(document.body, { childList:true, subtree:true });

  window.addEventListener('keydown', event => {
    if (!panel.classList.contains('hidden') && event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    const palette = $('.s4-palette');
    const input = $('#s4PaletteInput');
    if (palette && !palette.classList.contains('hidden') && event.key === 'Enter') {
      const query = String(input?.value || '').toLowerCase();
      if (/agent|autonomia|privacidade|parear|kill|controle/.test(query)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void open();
      }
    }
  }, true);

  installDockButton();
  installPaletteCommand();
  window.__sextaV4System = { open, close, refresh };
})();