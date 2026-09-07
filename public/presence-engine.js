(() => {
  if (window.__sextaPresence?.installed) return;

  const root = document.documentElement;
  const state = {
    voice: 'idle',
    toolDepth: 0,
    presence: 'standby',
    changedAt: Date.now()
  };

  const voiceMap = {
    idle: 'standby',
    off: 'standby',
    listening: 'listening',
    user_speaking: 'listening',
    thinking: 'thinking',
    speaking: 'speaking',
    tool: 'acting',
    reconnecting: 'reconnecting',
    connecting: 'reconnecting',
    error: 'error'
  };

  function relayDesktop(detail) {
    try { window.sextaDesktop?.presence?.update?.(detail); } catch {}
  }

  function publish(next, detail = {}) {
    const value = String(next || 'standby');
    if (state.presence === value && !detail.force) return;
    state.presence = value;
    state.changedAt = Date.now();
    root.dataset.sextaPresence = value;
    const payload = { state: value, voice: state.voice, toolDepth: state.toolDepth, changedAt: state.changedAt, ...detail };
    window.dispatchEvent(new CustomEvent('sexta:presence-state', { detail: payload }));
    relayDesktop(payload);
  }

  function reconcile(detail = {}) {
    if (state.toolDepth > 0) return publish('acting', detail);
    publish(voiceMap[state.voice] || 'standby', detail);
  }

  window.addEventListener('sexta:voice-state', event => {
    state.voice = String(event?.detail?.state || 'idle');
    reconcile({ source: 'voice' });
  });

  window.addEventListener('sexta:tool-state', event => {
    const phase = String(event?.detail?.phase || '');
    if (phase === 'start') state.toolDepth += Math.max(1, Number(event?.detail?.count) || 1);
    if (phase === 'complete') state.toolDepth = Math.max(0, state.toolDepth - Math.max(1, Number(event?.detail?.count) || 1));
    reconcile({ source: 'tool', tool: event?.detail?.tool || null });
  });

  root.dataset.sextaPresence = 'standby';
  relayDesktop({ state: 'standby', voice: 'idle', toolDepth: 0, changedAt: state.changedAt, source: 'boot' });
  window.__sextaPresence = {
    installed: true,
    version: '1.1.0',
    debug: () => ({ ...state })
  };
})();
