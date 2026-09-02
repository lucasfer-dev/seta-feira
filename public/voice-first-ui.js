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

  // Corrige visualmente erros recorrentes da transcrição do nome da assistente.
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

  // Watchdog de voz: depois de uma fala real, não deixa uma sessão aparentemente
  // conectada ficar muda por minutos. Se não houver resposta/ação em 9 s, refaz a sessão.
  let lastHint = String(voiceHint.textContent || '');
  let recoveryTimer = null;
  let recovering = false;

  function clearRecoveryTimer() {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }

  function armRecoveryTimer() {
    clearRecoveryTimer();
    recoveryTimer = setTimeout(async () => {
      const live = window.__sextaGeminiLive;
      const state = live?.debug?.();
      if (!live || !state?.sessionActive || !state?.setupComplete || state.assistantSpeaking || state.localVoiceActive || state.waitingForInput || state.pendingToolCalls > 0 || recovering) return;
      recovering = true;
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
    }, 9000);
  }

  const hintObserver = new MutationObserver(() => {
    const next = String(voiceHint.textContent || '');
    const heardUser = /te ouvindo/i.test(lastHint) && /SEXTA\s*•\s*ouvindo/i.test(next) && !/te ouvindo/i.test(next);
    if (heardUser) armRecoveryTimer();
    if (/falando|a[cç][aã]o em andamento|retomando|conectando|entrando na conversa|te ouvindo|recuperando/i.test(next)) clearRecoveryTimer();
    lastHint = next;
  });
  hintObserver.observe(voiceHint, { childList: true, subtree: true, characterData: true });

  // O segundo botão fazia a mesma coisa que o botão principal e poluía a experiência.
  if (wakeBtn) wakeBtn.setAttribute('aria-hidden', 'true');
  if (quickActions) quickActions.setAttribute('aria-hidden', 'true');
  setManualChat(false);
})();
