(() => {
  const chatStage = document.querySelector('#view-chat .chat-stage');
  if (!chatStage || document.querySelector('.sexta-v4-home')) return;

  document.body.classList.remove('sexta-v2', 'sexta-v3', 'sexta-v3-panel-open', 'sexta-panel-open', 'sexta-voice-first', 'manual-chat-open', 'sexta-manual-chat');
  document.body.classList.add('sexta-v4');
  document.body.dataset.voiceState = 'off';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia.' : hour < 18 ? 'Boa tarde.' : 'Boa noite.';
  const token = () => localStorage.getItem('sexta_token') || '';
  const authHeaders = () => ({ 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const shell = document.createElement('div');
  shell.className = 'sexta-v4-home';
  shell.innerHTML = `
    <div class="s4-ambient" aria-hidden="true"><i></i><i></i><i></i></div>

    <header class="s4-topbar">
      <button type="button" class="s4-brand" data-s4-home aria-label="Voltar ao núcleo">
        <span class="s4-brand-mark"><i></i></span>
        <span><strong>SEXTA</strong><small>PERSONAL INTELLIGENCE</small></span>
      </button>
      <div class="s4-presence" id="s4Presence"><i></i><span>ONLINE</span></div>
      <button type="button" class="s4-command-trigger" id="s4CommandTrigger">
        <span>Comandos</span><kbd>Ctrl K</kbd>
      </button>
    </header>

    <main class="s4-main">
      <section class="s4-core" aria-label="Núcleo da SEXTA">
        <button type="button" class="s4-orb" id="s4Orb" aria-label="Iniciar ou encerrar conversa por voz">
          <span class="s4-orb-halo h1"></span>
          <span class="s4-orb-halo h2"></span>
          <span class="s4-orb-body"><span class="s4-orb-eye"></span></span>
        </button>

        <div class="s4-copy">
          <p class="s4-kicker" id="s4Kicker">PRONTA</p>
          <h1>${greeting}</h1>
          <p class="s4-status" id="s4VoiceStatus">Fala comigo quando quiser.</p>
        </div>

        <div class="s4-transcript" id="s4Transcript" aria-live="polite">
          <span>O que você disser aparece aqui.</span>
        </div>

        <div class="s4-primary-actions">
          <button type="button" class="s4-primary" id="s4VoicePrimary">INICIAR CONVERSA</button>
          <button type="button" class="s4-quiet" id="s4ManualChat">DIGITAR</button>
        </div>
      </section>

      <section class="s4-context-strip" aria-label="Contexto e atividade">
        <article class="s4-context-card" id="s4ContextCard">
          <div class="s4-card-label"><span>CONTEXTO</span><i id="s4ContextDot"></i></div>
          <strong id="s4ContextTitle">Sem contexto local ativo</strong>
          <p id="s4ContextDetail">A Sexta assume contexto conforme você conversa ou usa o PC Agent.</p>
        </article>
        <article class="s4-context-card">
          <div class="s4-card-label"><span>AGORA</span><i class="amber"></i></div>
          <strong id="s4NowTitle">Aguardando você</strong>
          <p id="s4NowDetail">Nenhuma ação em andamento.</p>
        </article>
      </section>
    </main>

    <nav class="s4-dock" aria-label="Acessos rápidos">
      <button type="button" class="active" data-s4-home title="Núcleo"><span>◉</span><small>Core</small></button>
      <button type="button" data-s4-view="memory" title="Memória"><span>⌁</span><small>Memória</small></button>
      <button type="button" data-s4-view="activity" title="Atividade"><span>↗</span><small>Atividade</small></button>
      <button type="button" data-s4-view="devices" title="Dispositivos"><span>⌘</span><small>Dispositivos</small></button>
      <button type="button" data-s4-view="integrations" title="Integrações"><span>∞</span><small>Links</small></button>
      <button type="button" data-s4-view="settings" title="Personalidade"><span>⚙</span><small>Sistema</small></button>
    </nav>
  `;
  chatStage.insertBefore(shell, chatStage.firstChild);

  const returnBtn = document.createElement('button');
  returnBtn.className = 's4-return';
  returnBtn.type = 'button';
  returnBtn.textContent = '← NÚCLEO';
  document.body.append(returnBtn);

  const palette = document.createElement('div');
  palette.className = 's4-palette hidden';
  palette.setAttribute('role', 'dialog');
  palette.setAttribute('aria-modal', 'true');
  palette.setAttribute('aria-label', 'Comandos da Sexta');
  palette.innerHTML = `
    <button class="s4-palette-backdrop" type="button" aria-label="Fechar comandos"></button>
    <section class="s4-palette-panel">
      <div class="s4-palette-search">
        <span>⌘</span>
        <input id="s4PaletteInput" autocomplete="off" spellcheck="false" placeholder="O que você quer fazer?" />
        <kbd>Esc</kbd>
      </div>
      <div class="s4-palette-hint">AÇÕES RÁPIDAS</div>
      <div class="s4-command-list" id="s4CommandList"></div>
      <footer><span>↑↓ navegar</span><span>Enter executar</span><span>Ctrl K abrir</span></footer>
    </section>
  `;
  document.body.append(palette);

  const state = {
    voice: 'off',
    health: null,
    sync: null,
    agent: null,
    paletteIndex: 0
  };

  const voiceLabels = {
    off: ['PRONTA', 'Fala comigo quando quiser.', 'INICIAR CONVERSA'],
    connecting: ['CONECTANDO', 'Abrindo o canal de voz...', 'CONECTANDO...'],
    listening: ['OUVINDO', 'Pode falar.', 'ENCERRAR'],
    user_speaking: ['OUVINDO VOCÊ', 'Estou acompanhando.', 'ENCERRAR'],
    thinking: ['PENSANDO', 'Processando o contexto...', 'ENCERRAR'],
    speaking: ['RESPONDENDO', 'Falando com você.', 'ENCERRAR'],
    tool: ['AGINDO', 'Executando uma ação...', 'ENCERRAR'],
    recovering: ['RECUPERANDO', 'Reconectando a sessão...', 'RECONECTANDO...'],
    error: ['FALHA DE VOZ', 'Não consegui manter o canal.', 'TENTAR NOVAMENTE']
  };

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }

  function runPrompt(text) {
    const input = $('#messageInput');
    const form = $('#composer');
    if (!input || !form) return;
    closePalette();
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit?.();
  }

  function toggleVoice() {
    const live = window.__sextaGeminiLive;
    if (!live) return;
    live.active?.() ? live.stop?.() : live.start?.();
  }

  function openLegacy(view) {
    closePalette();
    document.body.classList.remove('sexta-manual-chat');
    document.body.classList.add('sexta-v4-panel-open');
    const nav = $(`.nav-item[data-view="${view}"]`) || $(`.mobile-nav [data-view="${view}"]`);
    nav?.click();
  }

  function closeLegacy() {
    document.body.classList.remove('sexta-v4-panel-open');
    $('.nav-item[data-view="chat"]')?.click();
  }

  const commands = [
    { label: 'Conversar por voz', detail: 'Iniciar ou encerrar conversa', icon: '◉', keywords: 'voz falar conversa microfone', run: toggleVoice },
    { label: 'Olhar minha tela', detail: 'PC Vision', icon: '◌', keywords: 'vision tela olhar pc', run: () => runPrompt('Sexta, olha minha tela e me diz o que está acontecendo.') },
    { label: 'Contexto atual', detail: 'Relembrar o que estamos fazendo', icon: '⌁', keywords: 'contexto memoria projeto atual', run: () => runPrompt('Sexta, o que você lembra sobre o que estamos fazendo agora?') },
    { label: 'Organizar agora', detail: 'Priorizar os próximos passos', icon: '↗', keywords: 'organizar tarefas agora prioridade', run: () => runPrompt('Sexta, organiza o que eu devo fazer agora com base no nosso contexto.') },
    { label: 'Status do computador', detail: 'PC Agent e sistema', icon: '⌘', keywords: 'status pc computador sistema agente', run: () => runPrompt('Sexta, me diga o status do meu computador.') },
    { label: 'Memória', detail: 'Abrir Knowledge Vault', icon: '⌁', keywords: 'memoria vault obsidian', run: () => openLegacy('memory') },
    { label: 'Atividade', detail: 'Ações e eventos recentes', icon: '↗', keywords: 'atividade eventos logs ações', run: () => openLegacy('activity') },
    { label: 'Dispositivos', detail: 'PC, Android e agentes', icon: '⌘', keywords: 'dispositivos pc android agent', run: () => openLegacy('devices') },
    { label: 'Integrações', detail: 'Google, WhatsApp e serviços', icon: '∞', keywords: 'integracoes google whatsapp serviços', run: () => openLegacy('integrations') },
    { label: 'Personalidade e sistema', detail: 'Ajustes da Sexta', icon: '⚙', keywords: 'configuracoes personalidade sistema ajustes', run: () => openLegacy('settings') }
  ];

  function filteredCommands() {
    const query = ($('#s4PaletteInput')?.value || '').trim().toLowerCase();
    if (!query) return commands;
    return commands.filter(item => `${item.label} ${item.detail} ${item.keywords}`.toLowerCase().includes(query));
  }

  function renderCommands() {
    const list = $('#s4CommandList');
    if (!list) return;
    const items = filteredCommands();
    if (state.paletteIndex >= items.length) state.paletteIndex = Math.max(0, items.length - 1);
    list.innerHTML = items.length ? items.map((item, index) => `
      <button type="button" class="s4-command-item ${index === state.paletteIndex ? 'selected' : ''}" data-command-index="${commands.indexOf(item)}">
        <span class="s4-command-icon">${item.icon}</span>
        <span><strong>${item.label}</strong><small>${item.detail}</small></span>
        <kbd>↵</kbd>
      </button>
    `).join('') : '<div class="s4-empty">Nenhum comando encontrado.</div>';

    $$('.s4-command-item', list).forEach(btn => {
      btn.addEventListener('mouseenter', () => {
        const originalIndex = Number(btn.dataset.commandIndex);
        state.paletteIndex = items.findIndex(item => commands.indexOf(item) === originalIndex);
        renderCommands();
      }, { once: true });
      btn.addEventListener('click', () => commands[Number(btn.dataset.commandIndex)]?.run());
    });
  }

  function openPalette() {
    state.paletteIndex = 0;
    palette.classList.remove('hidden');
    document.body.classList.add('sexta-v4-palette-open');
    const input = $('#s4PaletteInput');
    if (input) input.value = '';
    renderCommands();
    setTimeout(() => input?.focus(), 20);
  }

  function closePalette() {
    palette.classList.add('hidden');
    document.body.classList.remove('sexta-v4-palette-open');
  }

  function executeSelectedCommand() {
    const items = filteredCommands();
    items[state.paletteIndex]?.run();
  }

  function humanEvent(event) {
    if (!event) return null;
    const title = event.title || event.action || event.type || event.kind || event.name || 'Atividade recente';
    const detail = event.summary || event.message || event.detail || event.status || event.result || '';
    return { title: String(title), detail: typeof detail === 'string' ? detail : '' };
  }

  function contextFromAgent(agent) {
    const ctx = agent?.context || {};
    const windowTitle = ctx.activeWindow || ctx.activeWindowTitle || ctx.foregroundWindow || ctx.windowTitle || ctx.currentWindow;
    const task = ctx.currentTask || ctx.task || ctx.project;
    if (windowTitle) return { title: String(windowTitle), detail: task ? String(task) : `${agent.name || 'PC'} conectado` };
    if (task) return { title: String(task), detail: `${agent.name || 'PC'} conectado` };
    if (agent) return { title: agent.name || 'PC conectado', detail: 'Vision e Hands disponíveis conforme permissões.' };
    return { title: 'Sem contexto local ativo', detail: 'A Sexta assume contexto conforme você conversa ou usa o PC Agent.' };
  }

  function renderTelemetry() {
    const health = state.health || {};
    const sync = state.sync || {};
    const agent = state.agent;
    const online = Boolean(health.cloud || health.ai || token());
    const presence = $('#s4Presence');
    presence?.classList.toggle('warn', !online);
    if (presence) $('span', presence).textContent = online ? 'ONLINE' : 'LOCAL';

    const context = contextFromAgent(agent);
    $('#s4ContextTitle').textContent = context.title;
    $('#s4ContextDetail').textContent = context.detail;
    $('#s4ContextDot').classList.toggle('online', Boolean(agent));

    const currentEvent = humanEvent((sync.events || [])[0]);
    if (state.voice === 'tool') {
      $('#s4NowTitle').textContent = 'Executando ação';
      $('#s4NowDetail').textContent = 'A Sexta está usando uma ferramenta.';
    } else if (currentEvent) {
      $('#s4NowTitle').textContent = currentEvent.title;
      $('#s4NowDetail').textContent = currentEvent.detail || 'Evento recente registrado.';
    } else {
      $('#s4NowTitle').textContent = state.voice === 'off' ? 'Aguardando você' : voiceLabels[state.voice]?.[0] || 'Ativa';
      $('#s4NowDetail').textContent = state.voice === 'off' ? 'Nenhuma ação em andamento.' : voiceLabels[state.voice]?.[1] || '';
    }
  }

  function renderVoice(detail = {}) {
    const voice = detail.state || 'off';
    state.voice = voice;
    document.body.dataset.voiceState = voice;
    const labels = voiceLabels[voice] || voiceLabels.off;
    $('#s4Kicker').textContent = labels[0];
    $('#s4VoiceStatus').textContent = detail.label || labels[1];
    $('#s4VoicePrimary').textContent = labels[2];
    renderTelemetry();
  }

  function renderTranscript(detail = {}) {
    const text = String(detail.interim || detail.final || '').trim();
    const box = $('#s4Transcript');
    if (!box) return;
    box.classList.toggle('has-text', Boolean(text));
    box.textContent = text || 'O que você disser aparece aqui.';
  }

  async function refreshTelemetry(force = false) {
    try {
      state.health = await fetch('/api/health').then(r => r.json());
    } catch {
      state.health = null;
    }

    if (token()) {
      try {
        state.sync = await api(`/api/sync${force ? '?fresh=1' : ''}`);
        state.agent = (state.sync.devices || []).find(device => device.online && (device.context?.pcAgent || device.kind === 'agent')) || null;
      } catch {
        state.sync = null;
        state.agent = null;
      }
    }
    renderTelemetry();
  }

  $('#s4Orb').addEventListener('click', toggleVoice);
  $('#s4VoicePrimary').addEventListener('click', toggleVoice);
  $('#s4CommandTrigger').addEventListener('click', openPalette);
  $('.s4-palette-backdrop', palette).addEventListener('click', closePalette);
  $('#s4PaletteInput').addEventListener('input', () => { state.paletteIndex = 0; renderCommands(); });

  $('#s4ManualChat').addEventListener('click', () => {
    const open = !document.body.classList.contains('sexta-manual-chat');
    document.body.classList.toggle('sexta-manual-chat', open);
    $('#s4ManualChat').textContent = open ? 'FECHAR CHAT' : 'DIGITAR';
    if (open) setTimeout(() => $('#messageInput')?.focus(), 30);
  });

  $$('[data-s4-view]').forEach(btn => btn.addEventListener('click', () => openLegacy(btn.dataset.s4View)));
  $$('[data-s4-home]').forEach(btn => btn.addEventListener('click', closeLegacy));
  returnBtn.addEventListener('click', closeLegacy);

  window.addEventListener('keydown', event => {
    const isPaletteShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
    if (isPaletteShortcut) {
      event.preventDefault();
      palette.classList.contains('hidden') ? openPalette() : closePalette();
      return;
    }
    if (!palette.classList.contains('hidden')) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closePalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const length = filteredCommands().length;
        if (length) state.paletteIndex = (state.paletteIndex + 1) % length;
        renderCommands();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const length = filteredCommands().length;
        if (length) state.paletteIndex = (state.paletteIndex - 1 + length) % length;
        renderCommands();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        executeSelectedCommand();
      }
    }
  });

  window.addEventListener('sexta:voice-state', event => renderVoice(event.detail || {}));
  window.addEventListener('sexta:voice-transcript', event => renderTranscript(event.detail || {}));
  window.addEventListener('focus', () => refreshTelemetry(false));

  renderCommands();
  renderVoice({ state: 'off' });
  refreshTelemetry(true);
  setInterval(() => refreshTelemetry(false), 12000);

  window.__sextaV4 = {
    openCommands: openPalette,
    closeCommands: closePalette,
    refresh: () => refreshTelemetry(true),
    state: () => ({ voice: state.voice, agent: state.agent, health: state.health })
  };
})();