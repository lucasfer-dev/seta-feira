(() => {
  if (window.__sextaVoiceReliability?.installed || typeof window.WebSocket !== 'function') return;

  const NativeWebSocket = window.WebSocket;
  const NativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  const LIVE_URL = /generativelanguage\.googleapis\.com\/ws\/google\.ai\.generativelanguage\.v1beta\.GenerativeService\.BidiGenerateContentConstrained/i;
  const TOOL_CONTINUATION_TIMEOUT_MS = 6500;
  const FAILED_TOOL_CONTINUATION_TIMEOUT_MS = 3500;
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

  function compactError(value = '') {
    return String(value || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function responseFailed(item = {}) {
    const response = item?.response && typeof item.response === 'object' ? item.response : {};
    return response.ok === false || response.state === 'failed' || Boolean(response.error);
  }

  function responseError(item = {}) {
    const response = item?.response && typeof item.response === 'object' ? item.response : {};
    return compactError(response.error || response?.result?.error || response?.result?.message || '');
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
    let lastFailedToolNames = [];
    let lastToolErrors = [];
    let lastContinuationTimeoutMs = TOOL_CONTINUATION_TIMEOUT_MS;

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
          toolNames: lastToolNames.join(','),
          failedToolNames: lastFailedToolNames.join(','),
          toolErrors: lastToolErrors.join(' | ')
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
      lastFailedToolNames = [];
      lastToolErrors = [];
      lastContinuationTimeoutMs = TOOL_CONTINUATION_TIMEOUT_MS;
    }

    function armContinuationTimer(timeoutMs = TOOL_CONTINUATION_TIMEOUT_MS) {
      clearContinuationTimer();
      lastContinuationTimeoutMs = timeoutMs;
      continuationTimer = setTimeout(() => {
        if (!awaitingContinuation || continuationActivity) return;
        if (lastState === 'speaking' && markContinuationActivity('playback-state-timeout')) return;
        metric('tool_continuation_timeout', {
          timeoutMs,
          toolNames: lastToolNames.join(','),
          failedToolNames: lastFailedToolNames.join(','),
          toolErrors: lastToolErrors.join(' | '),
          suppressedTurnCompletes
        });
        try { socket.close(lastFailedToolNames.length ? 4012 : 4011, lastFailedToolNames.length ? 'failed-tool-continuation-timeout' : 'tool-continuation-timeout'); } catch {}
      }, timeoutMs);
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
          lastFailedToolNames = responses.filter(responseFailed).map(item => String(item?.name || '')).filter(Boolean).slice(0, 12);
          lastToolErrors = responses.filter(responseFailed).map(responseError).filter(Boolean).slice(0, 6);
          const timeoutMs = lastFailedToolNames.length ? FAILED_TOOL_CONTINUATION_TIMEOUT_MS : TOOL_CONTINUATION_TIMEOUT_MS;
          metric('tool_response_sent', {
            count: responses.length,
            failed: lastFailedToolNames.length,
            toolNames: lastToolNames.join(','),
            failedToolNames: lastFailedToolNames.join(','),
            toolErrors: lastToolErrors.join(' | '),
            continuationTimeoutMs: timeoutMs,
            suppressedTurnCompletes
          });
          armContinuationTimer(timeoutMs);
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
        lastFailedToolNames = [];
        lastToolErrors = [];
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
          toolNames: lastToolNames.join(','),
          failedToolNames: lastFailedToolNames.join(','),
          toolErrors: lastToolErrors.join(' | ')
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
          failedToolNames: lastFailedToolNames.join(','),
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
          timeoutMs: lastContinuationTimeoutMs,
          toolNames: lastToolNames.join(','),
          failedToolNames: lastFailedToolNames.join(','),
          toolErrors: lastToolErrors.join(' | ')
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
      for (const socket of liveSockets) {
        try { socket.__sextaMarkToolContinuation?.('playback-state'); } catch {}
      }
      metric('first_audio_state', { hadTranscript: Boolean(latestTranscript) });
    }
    lastState = next;
  });

  window.__sextaVoiceReliability = {
    installed: true,
    version: '10.1.2-failed-tool-fast-recovery',
    debug: () => ({
      currentTurnId,
      lastState,
      latestTranscript,
      liveSockets: liveSockets.size,
      continuationTimeoutMs: TOOL_CONTINUATION_TIMEOUT_MS,
      failedToolContinuationTimeoutMs: FAILED_TOOL_CONTINUATION_TIMEOUT_MS
    })
  };
})();
