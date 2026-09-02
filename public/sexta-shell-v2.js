(() => {
  const chatStage = document.querySelector('#view-chat .chat-stage');
  const voiceHint = document.querySelector('#voiceHint');
  const syncHint = document.querySelector('#syncHint');
  const oldVoiceBtn = document.querySelector('#voiceBtn');
  const navChat = document.querySelector('[data-view="chat"]');
  if (!chatStage) return;

  document.body.classList.remove('sexta-voice-first', 'manual-chat-open');
  document.body.classList.add('sexta-v2');
  document.body.dataset.voiceState = 'off';

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia.' : hour < 18 ? 'Boa tarde.' : 'Boa noite.';

  const shell = document.createElement('div');
  shell.className = 'sexta-v2-home';
  shell.innerHTML = `
    <div class="sexta-v2-top">
      <div class="sexta-v2-brand">SEXTA</div>
      <button type="button" class="sexta-v2-panel-btn" id="sextaPanelBtn">Painel</button>
    </div>
    <div class="sexta-v2-orb-wrap">
      <div class="sexta-v2-orb-halo"></div>
      <button type="button" class="sexta-v2-orb" id="sextaOrb" aria-label="Iniciar ou encerrar conversa">
        <span class="sexta-v2-orb-core"></span>
      </button>
    </div>
    <h1 class="sexta-v2-greeting" id="sextaGreeting">${greeting}</h1>
    <p class="sexta-v2-status" id="sextaV2Status">Pronta para conversar.</p>
    <div class="sexta-v2-transcript" id="sextaLiveTranscript" aria-live="polite">
      <span class="ghost">A transcrição aparece aqui enquanto você fala.</span>
    </div>
    <div class="sexta-v2-actions">
      <button type="button" class="sexta-v2-primary" id="sextaVoicePrimary">Iniciar conversa</button>
      <button type="button" class="sexta-v2-secondary" id="sextaManualChat">Chat manual</button>
    </div>
    <div class="sexta-v2-meta">
      <span><i></i><b id="sextaConnectionMeta">core pronto</b></span>
      <span id="sextaSyncMeta">contexto ao iniciar sessão</span>
    </div>
  `;
  chatStage.insertBefore(shell, chatStage.firstChild);

  const stateLabel = document.querySelector('#sextaV2Status');
  const transcript = document.querySelector('#sextaLiveTranscript');
  const primary = document.querySelector('#sextaVoicePrimary');
  const orb = document.querySelector('#sextaOrb');
  const manual = document.querySelector('#sextaManualChat');
  const panel = document.querySelector('#sextaPanelBtn');
  const connectionMeta = document.querySelector('#sextaConnectionMeta');
  const syncMeta = document.querySelector('#sextaSyncMeta');

  const labels = {
    off: ['Pronta para conversar.', 'Iniciar conversa'],
    connecting: ['Conectando a voz...', 'Conectando...'],
    listening: ['Ouvindo.', 'Encerrar conversa'],
    user_speaking: ['Ouvindo você.', 'Encerrar conversa'],
    thinking: ['Entendendo...', 'Encerrar conversa'],
    speaking: ['Respondendo.', 'Encerrar conversa'],
    tool: ['Executando uma ação...', 'Encerrar conversa'],
    recovering: ['Recuperando a conversa...', 'Reconectando...'],
    error: ['A voz encontrou um problema.', 'Tentar novamente']
  };

  let thinkingTimer = null;
  let lastDetail = { state: 'off' };

  function paintState(detail = {}) {
    const state = detail.state || 'off';
    lastDetail = detail;
    document.body.dataset.voiceState = state;
    const [text, button] = labels[state] || labels.off;
    if (stateLabel) stateLabel.textContent = detail.label || text;
    if (primary) primary.textContent = button;
    if (connectionMeta) {
      connectionMeta.textContent = detail.connection || (state === 'off' ? 'core pronto' : state === 'error' ? 'falha na sessão' : 'sessão ativa');
    }
    if (voiceHint) voiceHint.textContent = `SEXTA • ${text.toLowerCase()}`;
  }

  function renderState(detail = {}) {
    const state = detail.state || 'off';
    if (thinkingTimer && state !== 'thinking') {
      clearTimeout(thinkingTimer);
      thinkingTimer = null;
    }

    // Short model gaps are normal in Live. Avoid flashing "Entendendo..." for
    // a few hundred milliseconds; keep the conversation visually continuous.
    if (state === 'thinking') {
      lastDetail = detail;
      if (thinkingTimer) return;
      thinkingTimer = setTimeout(() => {
        thinkingTimer = null;
        if ((lastDetail.state || 'off') === 'thinking') paintState(lastDetail);
      }, 260);
      return;
    }

    paintState(detail);
  }

  function renderTranscript(detail = {}) {
    const interim = String(detail.interim || '').trim();
    const final = String(detail.final || '').trim();
    const text = interim || final;
    if (!transcript) return;
    if (!text) {
      transcript.classList.remove('has-text');
      transcript.innerHTML = '<span class="ghost">A transcrição aparece aqui enquanto você fala.</span>';
      return;
    }
    transcript.classList.add('has-text');
    transcript.textContent = text;
  }

  function toggleVoice() {
    const live = window.__sextaGeminiLive;
    if (!live) return;
    if (live.active?.()) live.stop?.();
    else live.start?.();
  }

  primary?.addEventListener('click', toggleVoice);
  orb?.addEventListener('click', toggleVoice);
  oldVoiceBtn?.addEventListener('click', () => setTimeout(() => renderState(window.__sextaGeminiLive?.debug?.() || {}), 0));

  manual?.addEventListener('click', () => {
    const open = !document.body.classList.contains('sexta-manual-chat');
    document.body.classList.toggle('sexta-manual-chat', open);
    manual.textContent = open ? 'Fechar chat manual' : 'Chat manual';
    if (open) setTimeout(() => document.querySelector('#messageInput')?.focus(), 80);
  });

  panel?.addEventListener('click', () => {
    document.body.classList.add('sexta-panel-open');
  });

  navChat?.addEventListener('click', () => {
    document.body.classList.remove('sexta-panel-open');
  });

  window.addEventListener('sexta:voice-state', event => renderState(event.detail || {}));
  window.addEventListener('sexta:voice-transcript', event => renderTranscript(event.detail || {}));
  window.addEventListener('sexta:session-context', event => {
    const detail = event.detail || {};
    if (syncMeta) syncMeta.textContent = detail.loadedAt ? `contexto ${new Date(detail.loadedAt).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}` : 'contexto carregado';
    if (syncHint) syncHint.textContent = syncMeta?.textContent || 'contexto carregado';
  });

  if (syncHint) syncHint.textContent = 'contexto ao iniciar sessão';
  renderState({ state: 'off' });
})();
