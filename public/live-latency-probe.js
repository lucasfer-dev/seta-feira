(() => {
  if (window.__sextaLatencyProbeInstalled || !window.WebSocket) return;
  window.__sextaLatencyProbeInstalled = true;

  const NativeWebSocket = window.WebSocket;
  const GEMINI_HOST = 'generativelanguage.googleapis.com';
  const PLATFORM = /Android/i.test(navigator.userAgent)
    ? 'android'
    : (/Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop) ? 'desktop' : 'browser');
  const CLIENT_END_SILENCE_MS = PLATFORM === 'android' ? 620 : 560;

  let sequence = 0;
  let playbackCandidate = null;
  let lastCompletedMetrics = null;

  const stamp = () => performance.now();
  const delta = (later, earlier) => later && earlier ? Math.round(later - earlier) : null;
  const turnId = () => `${Date.now().toString(36)}-${(++sequence).toString(36)}`;

  function authHeaders() {
    const token = localStorage.getItem('sexta_token') || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function newTurn() {
    return {
      turnId: turnId(),
      activityStartAt: 0,
      activityEndAt: 0,
      firstServerAt: 0,
      firstInputTranscriptAt: 0,
      firstModelAt: 0,
      firstAudioAt: 0,
      firstAudioScheduledAt: 0,
      firstPlaybackDueAt: 0,
      toolCallAt: 0,
      toolResponseAt: 0,
      turnCompleteAt: 0,
      toolCalls: 0,
      audioChunks: 0,
      manualActivityOpen: false,
      slowTimer: null
    };
  }

  function metricPayload(state, phase = 'complete') {
    if (!state) return null;
    const end = state.activityEndAt;
    return {
      kind: 'pipeline_v1',
      phase,
      platform: PLATFORM,
      turnId: state.turnId,
      clientEndSilenceConfiguredMs: CLIENT_END_SILENCE_MS,
      speechActivityMs: delta(state.activityEndAt, state.activityStartAt),
      endToFirstServerMs: delta(state.firstServerAt, end),
      endToInputTranscriptMs: state.firstInputTranscriptAt && end ? Math.max(0, delta(state.firstInputTranscriptAt, end)) : null,
      inputTranscriptBeforeEnd: Boolean(state.firstInputTranscriptAt && end && state.firstInputTranscriptAt < end),
      endToFirstModelMs: delta(state.firstModelAt, end),
      endToFirstAudioMs: delta(state.firstAudioAt, end),
      firstServerToAudioMs: delta(state.firstAudioAt, state.firstServerAt),
      audioReceivedToScheduledMs: delta(state.firstAudioScheduledAt, state.firstAudioAt),
      endToPlaybackDueMs: delta(state.firstPlaybackDueAt, end),
      endToToolCallMs: delta(state.toolCallAt, end),
      toolResponseMs: delta(state.toolResponseAt, state.toolCallAt),
      endToTurnCompleteMs: delta(state.turnCompleteAt, end),
      toolCalls: state.toolCalls,
      audioChunks: state.audioChunks
    };
  }

  function postMetrics(state, phase = 'complete') {
    const payload = metricPayload(state, phase);
    if (!payload) return;
    if (phase === 'complete') lastCompletedMetrics = payload;
    const log = payload.endToFirstAudioMs != null && payload.endToFirstAudioMs > 3000 ? console.warn : console.info;
    log('[SEXTA Latency]', payload);
    void fetch('/api/live-metrics', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {});
  }

  function scheduleSlowProbe(state) {
    clearTimeout(state.slowTimer);
    state.slowTimer = setTimeout(() => {
      if (state.activityEndAt && !state.firstAudioAt && !state.turnCompleteAt) postMetrics(state, 'slow_3s');
    }, 3000);
  }

  function inspectServerMessage(socket, raw) {
    const state = socket.__sextaTurn;
    if (!state?.activityStartAt) return;
    let message;
    try {
      const text = typeof raw === 'string' ? raw : null;
      if (!text) return;
      message = JSON.parse(text);
    } catch { return; }

    const now = stamp();
    if (state.activityEndAt && !state.firstServerAt) state.firstServerAt = now;

    if (message.toolCall) {
      if (!state.toolCallAt) state.toolCallAt = now;
      state.toolCalls += Array.isArray(message.toolCall.functionCalls) ? message.toolCall.functionCalls.length : 1;
    }

    const content = message.serverContent;
    if (!content) return;
    if (content.inputTranscription?.text && !state.firstInputTranscriptAt) state.firstInputTranscriptAt = now;

    const parts = content.modelTurn?.parts || [];
    if (parts.length && !state.firstModelAt) state.firstModelAt = now;
    if (!state.firstAudioAt && parts.some(part => Boolean(part?.inlineData?.data))) {
      state.firstAudioAt = now;
      playbackCandidate = state;
    }

    if (content.turnComplete) {
      state.turnCompleteAt = now;
      clearTimeout(state.slowTimer);
      setTimeout(() => postMetrics(state, 'complete'), 0);
    }
  }

  class SextaWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      this.__sextaTracked = String(url || '').includes(GEMINI_HOST);
      this.__sextaTurn = null;
      if (this.__sextaTracked) {
        this.addEventListener('message', event => {
          if (typeof event.data === 'string') inspectServerMessage(this, event.data);
          else if (event.data instanceof Blob) void event.data.text().then(text => inspectServerMessage(this, text)).catch(() => {});
        });
      }
    }

    send(data) {
      if (!this.__sextaTracked || typeof data !== 'string') return super.send(data);
      let message;
      try { message = JSON.parse(data); } catch { return super.send(data); }

      const realtime = message?.realtimeInput;
      if (!realtime) {
        if (message?.toolResponse && this.__sextaTurn?.toolCallAt && !this.__sextaTurn.toolResponseAt) {
          this.__sextaTurn.toolResponseAt = stamp();
        }
        return super.send(data);
      }

      if (realtime.audio?.data) {
        if (!this.__sextaTurn || (!this.__sextaTurn.manualActivityOpen && this.__sextaTurn.activityEndAt)) this.__sextaTurn = newTurn();
        const state = this.__sextaTurn || (this.__sextaTurn = newTurn());
        if (!state.manualActivityOpen) {
          state.manualActivityOpen = true;
          state.activityStartAt = stamp();
          super.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        }
        state.audioChunks += 1;
        return super.send(data);
      }

      // live-voice-v3 ainda chama audioStreamEnd. Com VAD automático desligado,
      // convertemos esse marcador para activityEnd sem alterar o restante do cliente.
      if (realtime.audioStreamEnd === true) {
        const state = this.__sextaTurn;
        if (state?.manualActivityOpen) {
          state.manualActivityOpen = false;
          state.activityEndAt = stamp();
          scheduleSlowProbe(state);
          return super.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
        }
        return;
      }

      return super.send(data);
    }
  }

  // A subclasse herda CONNECTING/OPEN/CLOSING/CLOSED do WebSocket nativo.
  window.WebSocket = SextaWebSocket;

  const sourceProto = window.AudioBufferSourceNode?.prototype;
  const nativeStart = sourceProto?.start;
  if (sourceProto && nativeStart && !sourceProto.__sextaLatencyPatched) {
    Object.defineProperty(sourceProto, '__sextaLatencyPatched', { value: true });
    sourceProto.start = function patchedStart(when, ...rest) {
      const state = playbackCandidate;
      if (state && !state.firstAudioScheduledAt) {
        const now = stamp();
        state.firstAudioScheduledAt = now;
        const contextNow = Number(this.context?.currentTime || 0);
        const requestedStart = Number.isFinite(Number(when)) ? Number(when) : contextNow;
        const delayMs = Math.max(0, (requestedStart - contextNow) * 1000);
        state.firstPlaybackDueAt = now + delayMs;
        playbackCandidate = null;
      }
      return nativeStart.call(this, when, ...rest);
    };
  }

  window.__sextaLatency = {
    last: () => lastCompletedMetrics,
    platform: PLATFORM
  };
})();
