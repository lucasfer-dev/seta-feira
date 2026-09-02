(() => {
  const composer = document.querySelector('#composer');
  const input = document.querySelector('#messageInput');
  const sendBtn = document.querySelector('#sendBtn');
  const voiceBtn = document.querySelector('#voiceBtn');
  const wakeBtn = document.querySelector('#wakeBtn');
  const voiceHint = document.querySelector('#voiceHint');
  const messages = document.querySelector('#messages');
  const quickActions = document.querySelector('.quick-actions');
  if (!composer || !voiceBtn || !voiceHint) return;

  document.body.classList.add('sexta-voice-first');
  voiceBtn.setAttribute('aria-label', 'Ativar ou desativar conversa por voz');
  voiceBtn.title = 'Conversar por voz com a SEXTA';

  const style = document.createElement('style');
  style.textContent = `
    body.sexta-voice-first .chat-stage { position: relative; }
    body.sexta-voice-first .quick-actions { display: none !important; }
    body.sexta-voice-first .voice-manual-toggle {
      display: inline-flex; align-items: center; gap: 8px; align-self: center;
      border: 1px solid rgba(255,255,255,.12); border-radius: 999px;
      background: rgba(10,14,24,.72); color: rgba(255,255,255,.72);
      padding: 8px 13px; margin: 0 auto 10px; cursor: pointer;
      font: inherit; font-size: 12px; letter-spacing: .02em;
    }
    body.sexta-voice-first .voice-manual-toggle:hover { color: #fff; border-color: rgba(255,255,255,.24); }
    body.sexta-voice-first:not(.manual-chat-open) #messageInput,
    body.sexta-voice-first:not(.manual-chat-open) #sendBtn,
    body.sexta-voice-first:not(.manual-chat-open) #wakeBtn { display: none !important; }
    body.sexta-voice-first:not(.manual-chat-open) .composer {
      width: auto; min-width: 108px; align-self: center; justify-content: center;
      padding: 8px; border: 0; background: transparent; box-shadow: none;
    }
    body.sexta-voice-first:not(.manual-chat-open) #voiceBtn {
      display: grid !important; place-items: center; width: 82px; height: 82px;
      min-width: 82px; border-radius: 50%; font-size: 30px;
      border: 1px solid rgba(255,255,255,.18);
      background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.12), rgba(15,20,32,.94));
      box-shadow: 0 12px 36px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.03);
      transition: transform .16s ease, box-shadow .2s ease, border-color .2s ease;
    }
    body.sexta-voice-first:not(.manual-chat-open) #voiceBtn:hover { transform: scale(1.035); }
    body.sexta-voice-first:not(.manual-chat-open) #voiceBtn.active {
      border-color: rgba(103,232,249,.72);
      box-shadow: 0 0 0 8px rgba(103,232,249,.07), 0 0 36px rgba(103,232,249,.22);
    }
    body.sexta-voice-first.sexta-user-speaking:not(.manual-chat-open) #voiceBtn.active {
      transform: scale(1.045);
      box-shadow: 0 0 0 11px rgba(103,232,249,.09), 0 0 44px rgba(103,232,249,.28);
    }
    body.sexta-voice-first.manual-chat-open #wakeBtn { display: none !important; }
    body.sexta-voice-first.manual-chat-open .composer { width: 100%; }
    body.sexta-voice-first .composer-hint { justify-content: center; }
    body.sexta-voice-first .voice-primary-label {
      text-align: center; margin: -2px auto 8px; font-size: 11px;
      letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.42);
    }
    @media (max-width: 700px) {
      body.sexta-voice-first:not(.manual-chat-open) #voiceBtn { width: 76px; height: 76px; min-width: 76px; }
      body.sexta-voice-first .voice-manual-toggle { padding: 7px 11px; }
    }
  `;
  document.head.appendChild(style);

  const label = document.createElement('div');
  label.className = 'voice-primary-label';
  label.textContent = 'voz principal';
  composer.parentElement?.insertBefore(label, composer);

  const manualToggle = document.createElement('button');
  manualToggle.type = 'button';
  manualToggle.className = 'voice-manual-toggle';
  manualToggle.textContent = '⌨ Abrir chat manual';
  manualToggle.setAttribute('aria-expanded', 'false');
  composer.parentElement?.insertBefore(manualToggle, composer);

  function setManualChat(open) {
    document.body.classList.toggle('manual-chat-open', open);
    manualToggle.setAttribute('aria-expanded', String(open));
    manualToggle.textContent = open ? '× Fechar chat manual' : '⌨ Abrir chat manual';
    label.textContent = open ? 'chat manual opcional' : 'voz principal';
    if (open) setTimeout(() => input?.focus(), 60);
  }

  manualToggle.addEventListener('click', () => {
    setManualChat(!document.body.classList.contains('manual-chat-open'));
  });

  function normalizeWakeName(text) {
    return String(text || '')
      .replace(/\bse\s*xta\s*[-–— ]*fe\s*i\s*ra\b/gi, 'Sexta-feira')
      .replace(/\bsex\s*ta\s*[-–— ]*fe\s*i\s*ra\b/gi, 'Sexta-feira')
      .replace(/\bsexta\s*[-–— ]*fe\s*i\s*ra\b/gi, 'Sexta-feira');
  }

  function cleanVisibleTranscripts(root = messages) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const clean = normalizeWakeName(node.nodeValue);
      if (clean !== node.nodeValue) node.nodeValue = clean;
    }
  }

  if (messages) {
    cleanVisibleTranscripts();
    new MutationObserver(() => cleanVisibleTranscripts()).observe(messages, { childList: true, subtree: true, characterData: true });
  }

  // O RMS local é telemetria, não estado de sessão. A legenda não deve piscar entre
  // “te ouvindo” e “ouvindo” a cada micro-pausa; mostramos atividade pelo botão/orb.
  let stabilizingHint = false;
  const hintObserver = new MutationObserver(() => {
    if (stabilizingHint) {
      stabilizingHint = false;
      return;
    }
    const raw = String(voiceHint.textContent || '');
    if (/SEXTA\s*•\s*te ouvindo/i.test(raw)) {
      stabilizingHint = true;
      voiceHint.textContent = 'SEXTA • ouvindo...';
    }
  });
  hintObserver.observe(voiceHint, { childList: true, subtree: true, characterData: true });

  // Watchdog baseado no estado real do Voice Core, não na legenda da interface.
  // Uma fala humana real que termina arma um prazo; qualquer resposta/ação cancela.
  let previousSpeech = false;
  let speechStartedAt = 0;
  let responseDeadline = 0;
  let recovering = false;

  async function recoverVoice() {
    if (recovering) return;
    const live = window.__sextaGeminiLive;
    const state = live?.debug?.();
    if (!live || !state?.sessionActive || !state?.setupComplete || state.assistantSpeaking || state.localVoiceActive || state.pendingToolCalls > 0) return;
    recovering = true;
    responseDeadline = 0;
    voiceHint.textContent = 'SEXTA • recuperando voz...';
    try {
      live.stop?.();
      await new Promise(resolve => setTimeout(resolve, 220));
      await live.start?.();
    } catch (error) {
      console.warn('SEXTA voice watchdog:', error);
    } finally {
      recovering = false;
    }
  }

  window.setInterval(() => {
    const live = window.__sextaGeminiLive;
    const state = live?.debug?.();
    if (!state?.sessionActive) {
      previousSpeech = false;
      speechStartedAt = 0;
      responseDeadline = 0;
      document.body.classList.remove('sexta-user-speaking');
      return;
    }

    const speaking = Boolean(state.localVoiceActive);
    document.body.classList.toggle('sexta-user-speaking', speaking);

    if (speaking && !previousSpeech) {
      speechStartedAt = performance.now();
      responseDeadline = 0;
    }

    if (!speaking && previousSpeech) {
      const duration = Math.max(0, performance.now() - speechStartedAt);
      if (duration >= 240 && state.setupComplete) responseDeadline = Date.now() + 8000;
    }

    if (state.assistantSpeaking || state.pendingToolCalls > 0 || /falando|a[cç][aã]o em andamento|conectando|retomando|entrando na conversa|recuperando/i.test(String(voiceHint.textContent || ''))) {
      responseDeadline = 0;
    }

    if (responseDeadline && Date.now() >= responseDeadline && !speaking && !state.assistantSpeaking && state.pendingToolCalls === 0) {
      void recoverVoice();
    }

    previousSpeech = speaking;
  }, 180);

  if (wakeBtn) wakeBtn.setAttribute('aria-hidden', 'true');
  if (quickActions) quickActions.setAttribute('aria-hidden', 'true');
  setManualChat(false);
})();
