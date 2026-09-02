(() => {
  const marks = {
    speechStart: 0,
    firstInterim: 0,
    firstFinal: 0,
    firstSpeaking: 0
  };
  let mic = null;
  let reported = false;

  function authHeaders() {
    const token = localStorage.getItem('sexta_token') || '';
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  function resetTurn() {
    marks.speechStart = 0;
    marks.firstInterim = 0;
    marks.firstFinal = 0;
    marks.firstSpeaking = 0;
    reported = false;
  }

  function report(reason) {
    if (reported || !marks.speechStart) return;
    reported = true;
    const settings = mic?.settings || {};
    const payload = {
      kind: 'voice_core_v5_browser',
      phase: reason,
      platform: 'browser',
      speechStartToInterimMs: marks.firstInterim ? Math.round(marks.firstInterim - marks.speechStart) : null,
      speechStartToFinalMs: marks.firstFinal ? Math.round(marks.firstFinal - marks.speechStart) : null,
      speechStartToSpeakingMs: marks.firstSpeaking ? Math.round(marks.firstSpeaking - marks.speechStart) : null,
      trackSampleRate: Number(settings.sampleRate || 0) || null,
      trackSampleSize: Number(settings.sampleSize || 0) || null,
      trackChannelCount: Number(settings.channelCount || 0) || null,
      trackLatencyMs: Number.isFinite(Number(settings.latency)) ? Math.round(Number(settings.latency) * 1000) : null,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl
    };
    fetch('/api/live-metrics', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }).catch(() => {});
  }

  window.addEventListener('sexta:mic-settings', event => {
    mic = event.detail || null;
  });

  window.addEventListener('sexta:voice-state', event => {
    const state = event.detail?.state;
    const now = performance.now();
    if (state === 'user_speaking') {
      if (!marks.speechStart) {
        resetTurn();
        marks.speechStart = now;
      }
      return;
    }
    if (state === 'speaking') {
      if (marks.speechStart && !marks.firstSpeaking) marks.firstSpeaking = now;
      report('response_started');
      return;
    }
    if (state === 'recovering' && marks.speechStart) report('recovering');
  });

  window.addEventListener('sexta:voice-transcript', event => {
    if (!marks.speechStart) return;
    const now = performance.now();
    const interim = String(event.detail?.interim || '').trim();
    const finalText = String(event.detail?.final || '').trim();
    if (interim && !marks.firstInterim) marks.firstInterim = now;
    if (finalText && !marks.firstFinal) marks.firstFinal = now;
  });
})();
