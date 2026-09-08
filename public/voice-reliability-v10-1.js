(() => {
  if (window.__sextaVoiceReliability?.installed || typeof window.WebSocket !== 'function') return;

  const NativeWebSocket = window.WebSocket;
  const NativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const LIVE_URL = /generativelanguage\.googleapis\.com\/ws\/google\.ai\.generativelanguage\.v1beta\.GenerativeService\.BidiGenerateContentConstrained/i;
  const TOOL_CONTINUATION_TIMEOUT_MS = 10000;
  const ORIGIN = /Android/i.test(navigator.userAgent)
    ? 'android'
    : (/Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop) ? 'desktop' : 'browser');

  let currentTurnId = '';
  let turnSequence = 0;
  let lastState = 'off';
  let latestTranscript = '';
  const liveSockets = new Set();

  function authHeaders() {
    const token = localStorage.getItem('sexta_token') || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function nextTurnId() {
    turnSequence += 1;
    return `${ORIGIN}-${Date.now().toString(36)}-${turnSequence.toString(36)}`;
  }

  // Correlaciona também as métricas produzidas pelo Voice Core antigo sem tocar
  // na lógica de áudio dele. Só reescreve POSTs locais de /api/live-metrics.
  if (NativeFetch) {
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : String(input?.url || '');
      if (url === '/api/live-metrics' && typeof init?.body === 'string') {
        try {
          const body = JSON.parse(init.body);
          if (body && typeof body === 'object') {
            if (!body.turnId && currentTurnId) body.turnId = currentTurnId;
            if (!body.clientTimestamp) body.clientTimestamp = new Date().toISOString();
            if (!body.platform || body.platform === 'browser') body.platform = ORIGIN;
            return NativeFetch(input, { ...init, body: JSON.stringify(body) });
          }
        } catch {}
      }
      return NativeFetch(input, init);
    };
  }

  function metric(kind, extra = {}) {
    void fetch('/api/live-metrics', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        kind: `voice_reliability_v10_1:${kind}`,
        phase: String(extra.phase || 'complete'),
        platform: ORIGIN,
        turnId: currentTurnId,
        state: lastState,
        clientTimestamp: new Date().toISOString(),
        ...extra
      })
    }).catch(() => {});
  }

  function usefulServerContent(content = {}) {
    return Object.keys(content).some(key => key !== 'turnComplete' && key !== 'waitingForInput');
  }

  function installSocketGuard(socket) {
    if (!socket || socket.__sextaReliabilityGuarded) return socket;
    Object.defineProperty(socket, '__sextaReliabilityGuarded', { value: true });
    liveSockets.add(socket);

    const nativeSend = socket.send.bind(socket);
    const replayEvents = new WeakSet();
    let toolPending = false;
    let awaitingContinuation = false;
    let continuationActivity = false;
    let continuationTimer = null;
    let suppressedTurnCompletes = 0;
    let lastToolNames = [];

    function clearContinuationTimer() {
      if (continuationTimer) clearTimeout(continuationTimer);
      continuationTimer = null;
    }

    function markContinuationActivity(source = 'server-content', detail = {}) {
      if (!awaitingContinuation) return false;
      if (!continuationActivity) {
        continuationActivity = true;
        metric('tool_continuation_started', {
          source,
          hasAudio: detail.hasAudio === true,
          hasOutputText: detail.hasOutputText === true,
          toolNames: lastToolNames.join(',')
        });
      }
      clearContinuationTimer();
      return true;
    }

    try {
      Object.defineProperty(socket, '__sextaMarkToolContinuation', {
        value: source => markContinuationActivity(source || 'playback-state'),
        configurable: true
      });
    } catch {
      try { socket.__sextaMarkToolContinuation = source => markContinuationActivity(source || 'playback-state'); } catch {}
    }

    function resetToolLifecycle() {
      clearContinuationTimer();
      toolPending = false;
      awaitingContinuation = false;
      continuationActivity = false;
      suppressedTurnCompletes = 0;
      lastToolNames = [];
    }

    function armContinuationTimer() {
      clearContinuationTimer();
      continuationTimer = setTimeout(() => {
        if (!awaitingContinuation || continuationActivity) return;
        // O Voice Core é quem realmente agenda o áudio. Em produção observamos
        // pacotes que colocavam o Core em `speaking`, mas não casavam com a forma
        // de inlineData esperada por este guard. Playback real vence o watchdog.
        if (lastState === 'speaking' && markContinuationActivity('playback-state-timeout')) return;
        metric('tool_continuation_timeout', {
          timeoutMs: TOOL_CONTINUATION_TIMEOUT_MS,
          toolNames: lastToolNames.join(','),
          suppressedTurnCompletes
        });
        try { socket.close(4011, 'tool-continuation-timeout'); } catch {}
      }, TOOL_CONTINUATION_TIMEOUT_MS);
    }

    socket.send = data => {
      try {
        const message = typeof data === 'string' ? JSON.parse(data) : null;
        const responses = message?.toolResponse?.functionResponses;
        if (Array.isArray(responses) && responses.length) {
          toolPending = false;
          awaitingContinuation = true;
          continuationActivity = false;
          lastToolNames = responses.map(item => String(item?.name || '')).filter(Boolean).slice(0, 12);
          metric('tool_response_sent', {
            count: responses.length,
            toolNames: lastToolNames.join(','),
            suppressedTurnCompletes
          });
          armContinuationTimer();
        }
      } catch {}
      return nativeSend(data);
    };

    socket.addEventListener('message', event => {
      if (replayEvents.has(event) || typeof event.data !== 'string') return;

      let message;
      try { message = JSON.parse(event.data); } catch { return; }

      const calls = message?.toolCall?.functionCalls;
      if (Array.isArray(calls) && calls.length) {
        toolPending = true;
        awaitingContinuation = false;
        continuationActivity = false;
        clearContinuationTimer();
        lastToolNames = calls.map(item => String(item?.name || '')).filter(Boolean).slice(0, 12);
        metric('tool_call_received', { count: calls.length, toolNames: lastToolNames.join(',') });
      }

      const content = message?.serverContent;
      if (!content || typeof content !== 'object') return;

      const hasAudio = (content.modelTurn?.parts || []).some(part => Boolean(part?.inlineData?.data));
      const hasOutputText = Boolean(String(content.outputTranscription?.text || '').trim());
      if (awaitingContinuation && (hasAudio || hasOutputText)) {
        markContinuationActivity('server-content', { hasAudio, hasOutputText });
      }

      const prematureComplete = content.turnComplete === true && (
        toolPending || (awaitingContinuation && !continuationActivity)
      );
      const prematureWaiting = content.waitingForInput === true && awaitingContinuation && !continuationActivity;

      if (prematureComplete || prematureWaiting) {
        event.stopImmediatePropagation();
        const clone = JSON.parse(JSON.stringify(message));
        if (clone.serverContent) {
          if (prematureComplete) delete clone.serverContent.turnComplete;
          if (prematureWaiting) delete clone.serverContent.waitingForInput;
        }
        if (prematureComplete) suppressedTurnCompletes += 1;
        metric('premature_turn_boundary_suppressed', {
          toolPending,
          awaitingContinuation,
          suppressedTurnCompletes,
          toolNames: lastToolNames.join(',')
        });

        if (clone.toolCall || usefulServerContent(clone.serverContent || {})) {
          const replay = new MessageEvent('message', { data: JSON.stringify(clone) });
          replayEvents.add(replay);
          socket.dispatchEvent(replay);
        }
        return;
      }

      if (content.turnComplete === true && awaitingContinuation && continuationActivity) {
        metric('tool_continuation_complete', {
          toolNames: lastToolNames.join(','),
          suppressedTurnCompletes
        });
        resetToolLifecycle();
      }
    }, { capture: true });

    socket.addEventListener('close', event => {
      clearContinuationTimer();
      liveSockets.delete(socket);
      if (awaitingContinuation && !continuationActivity) {
        metric('socket_closed_while_waiting_tool_continuation', {
          closeCode: Number(event?.code || 0),
          toolNames: lastToolNames.join(',')
        });
      }
      resetToolLifecycle();
    }, { once: true });

    return socket;
  }

  const GuardedWebSocket = new Proxy(NativeWebSocket, {
    construct(Target, args, NewTarget) {
      const socket = Reflect.construct(Target, args, NewTarget);
      const url = String(args?.[0] || '');
      return LIVE_URL.test(url) ? installSocketGuard(socket) : socket;
    }
  });

  window.WebSocket = GuardedWebSocket;

  window.addEventListener('sexta:voice-transcript', event => {
    latestTranscript = String(event?.detail?.final || event?.detail?.interim || '').trim();
  });

  window.addEventListener('sexta:voice-state', event => {
    const next = String(event?.detail?.state || lastState || 'off');
    if (next === 'user_speaking' && lastState !== 'user_speaking') {
      currentTurnId = nextTurnId();
      metric('turn_started', { hadTranscript: Boolean(latestTranscript) });
    }
    if (next === 'recovering' && lastState !== 'recovering') {
      metric('recovering', { hadTranscript: Boolean(latestTranscript) });
    }
    if (next === 'speaking' && lastState !== 'speaking') {
      // Este é o sinal mais confiável de que o Core recebeu e começou a tocar a
      // continuação. Cancela o watchdog mesmo se o guard não reconheceu o pacote.
      for (const socket of liveSockets) {
        try { socket.__sextaMarkToolContinuation?.('playback-state'); } catch {}
      }
      metric('first_audio_state', { hadTranscript: Boolean(latestTranscript) });
    }
    lastState = next;
  });

  window.__sextaVoiceReliability = {
    installed: true,
    version: '10.1.1-playback-continuation-guard',
    debug: () => ({
      currentTurnId,
      lastState,
      latestTranscript,
      liveSockets: liveSockets.size,
      continuationTimeoutMs: TOOL_CONTINUATION_TIMEOUT_MS
    })
  };
})();
