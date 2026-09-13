(() => {
  if (window.__sextaProactivity?.installed) return;
  const INTERVAL_MS = Math.max(30000, Number(window.SEXTA_PROACTIVITY_INTERVAL_MS || 60000));
  const LOCK_KEY = 'sexta_proactivity_tick_at';
  const ATTENTION_PRIORITY = 80;
  const INTERRUPT_PRIORITY = 95;
  const QUIET_HOURS_URGENT_PRIORITY = 99;
  const URGENT_COOLDOWN_MS = Math.max(60000, Number(window.SEXTA_URGENT_COOLDOWN_MS || 300000));
  const DEDUPE_TTL_MS = Math.max(60000, Number(window.SEXTA_PROACTIVITY_DEDUPE_MS || 1800000));
  let timer = null;
  let running = false;
  let ticks = 0;
  let triggers = 0;
  let interruptions = 0;
  let lastRunAt = '';
  let lastError = '';
  let voiceState = 'off';
  let urgentAudio = null;
  let urgentAudioUrl = '';
  let lastInterruptAt = 0;
  let resumeVoiceAfterUrgent = false;
  const seenEvents = new Map();

  const token = () => localStorage.getItem('sexta_token') || '';
  function lockedByAnotherTab() {
    const last = Number(localStorage.getItem(LOCK_KEY) || 0);
    return Number.isFinite(last) && Date.now() - last < INTERVAL_MS * 0.82;
  }
  function acquire() { localStorage.setItem(LOCK_KEY, String(Date.now())); }
  function priorityOf(item = {}) {
    const raw = Number(item?.notification?.priority ?? item?.details?.priority ?? item?.priority ?? 0);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
  }
  function classify(item = {}) {
    const priority = priorityOf(item);
    return { ...item, priority, delivery: priority >= INTERRUPT_PRIORITY ? 'urgent' : priority >= ATTENTION_PRIORITY ? 'attention' : 'silent' };
  }
  function eventKey(item = {}) {
    return JSON.stringify([item?.id || '', item?.name || '', item?.notification?.body || '', item?.details?.title || '']).slice(0,800);
  }
  function dedupe(item = {}) {
    const now = Date.now();
    for (const [key, at] of seenEvents) if (now - at > DEDUPE_TTL_MS) seenEvents.delete(key);
    const key = eventKey(item); if (seenEvents.has(key)) return false; seenEvents.set(key,now); return true;
  }
  function quietHoursActive(date = new Date()) {
    const start = Math.max(0,Math.min(23,Number(localStorage.getItem('sexta_quiet_start_hour') || 22)));
    const end = Math.max(0,Math.min(23,Number(localStorage.getItem('sexta_quiet_end_hour') || 7)));
    const hour = date.getHours(); return start > end ? hour >= start || hour < end : hour >= start && hour < end;
  }
  function urgentText(item = {}) {
    const body = String(item?.notification?.body || item?.details?.title || item?.message || item?.name || 'Uma condição urgente precisa da sua atenção.')
      .replace(/\s+/g, ' ').trim().slice(0, 420);
    return body ? `Chefe, ${body}` : 'Chefe, preciso da sua atenção.';
  }
  function releaseUrgentAudio(resume = true) {
    try { urgentAudio?.pause?.(); } catch {}
    urgentAudio = null;
    if (urgentAudioUrl) {
      try { URL.revokeObjectURL(urgentAudioUrl); } catch {}
      urgentAudioUrl = '';
    }
    if (resume && resumeVoiceAfterUrgent) { resumeVoiceAfterUrgent = false; setTimeout(() => void window.__sextaGeminiLive?.start?.(),160); }
  }
  async function speakUrgent(item) {
    if (!token() || typeof Audio !== 'function') return false;
    releaseUrgentAudio(false);
    try {
      resumeVoiceAfterUrgent = Boolean(window.__sextaGeminiLive?.active?.());
      if (resumeVoiceAfterUrgent) window.__sextaGeminiLive.stop?.();
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ text: urgentText(item), personality: { warmth:58, formality:55 } })
      });
      if (!response.ok) throw new Error(`TTS_HTTP_${response.status}`);
      const blob = await response.blob();
      if (!blob.size) throw new Error('TTS_EMPTY');
      urgentAudioUrl = URL.createObjectURL(blob);
      urgentAudio = new Audio(urgentAudioUrl);
      urgentAudio.addEventListener('ended', () => releaseUrgentAudio(true), { once:true });
      urgentAudio.addEventListener('error', () => releaseUrgentAudio(true), { once:true });
      await urgentAudio.play();
      return true;
    } catch (error) {
      releaseUrgentAudio(true);
      lastError = `urgent_audio:${String(error?.message || error).slice(0, 240)}`;
      return false;
    }
  }
  async function tick({ force = false } = {}) {
    if (running || !token()) return null;
    if (!force && lockedByAnotherTab()) return null;
    running = true; acquire();
    try {
      const response = await fetch('/api/monitor/run', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: '{}' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      ticks += 1; lastRunAt = new Date().toISOString(); lastError = '';
      const raw = Array.isArray(data?.results?.eventEngine?.triggered) ? data.results.eventEngine.triggered : [];
      const fired = raw.map(classify).filter(dedupe);
      const urgentCandidates = fired.filter(item => item.delivery === 'urgent');
      const quiet = quietHoursActive();
      const cooldownReady = Date.now() - lastInterruptAt >= URGENT_COOLDOWN_MS;
      const urgent = urgentCandidates.filter(item => cooldownReady && (!quiet || item.priority >= QUIET_HOURS_URGENT_PRIORITY));
      const suppressedUrgent = urgentCandidates.filter(item => !urgent.includes(item));
      const attention = [...fired.filter(item => item.delivery === 'attention'), ...suppressedUrgent];
      const silent = fired.filter(item => item.delivery === 'silent');
      triggers += fired.length;
      window.dispatchEvent(new CustomEvent('sexta:proactivity-tick', { detail: { ...data, fired, urgent, attention, silent } }));
      if (fired.length) window.dispatchEvent(new CustomEvent('sexta:proactive-event', { detail: { fired, urgent, attention, silent, at: lastRunAt } }));

      if (urgent.length) {
        lastInterruptAt = Date.now();
        interruptions += urgent.length;
        const spoken = await speakUrgent(urgent[0]);
        window.dispatchEvent(new CustomEvent('sexta:proactive-interrupt', {
          detail: { fired: urgent, at: lastRunAt, voiceState, reason: 'priority-threshold', spoken }
        }));
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        const visible = [...urgent, ...attention].slice(0, 3);
        for (const item of visible) {
          try {
            new Notification(item.name || 'SEXTA', {
              body: item?.notification?.body || item?.details?.title || 'Uma condição monitorada foi atendida.',
              icon: '/icon.svg',
              silent: item.delivery !== 'urgent'
            });
          } catch {}
        }
      }
      return data;
    } catch (error) {
      lastError = String(error?.message || error).slice(0, 300);
      window.dispatchEvent(new CustomEvent('sexta:proactivity-error', { detail: { error: lastError } }));
      return null;
    } finally { running = false; }
  }
  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => void tick(), INTERVAL_MS);
    setTimeout(() => void tick(), 4500);
  }
  window.addEventListener('sexta:voice-state', event => { voiceState = String(event?.detail?.state || voiceState || 'off'); });
  window.addEventListener('storage', event => { if (event.key === 'sexta_token' && event.newValue) void tick({ force: true }); });
  window.addEventListener('online', () => void tick());
  window.__sextaProactivity = {
    installed: true,
    version: '1.3.0-guardrails',
    tick: () => tick({ force: true }),
    debug: () => ({ intervalMs:INTERVAL_MS, attentionPriority:ATTENTION_PRIORITY, interruptPriority:INTERRUPT_PRIORITY, quietHoursUrgentPriority:QUIET_HOURS_URGENT_PRIORITY, urgentCooldownMs:URGENT_COOLDOWN_MS, dedupeTtlMs:DEDUPE_TTL_MS, voiceState, running, ticks, triggers, interruptions, lastInterruptAt, urgentAudioActive:Boolean(urgentAudio), lastRunAt, lastError })
  };
  schedule();
})();
