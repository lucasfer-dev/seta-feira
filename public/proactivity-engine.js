(() => {
  if (window.__sextaProactivity?.installed) return;
  const INTERVAL_MS = Math.max(30000, Number(window.SEXTA_PROACTIVITY_INTERVAL_MS || 60000));
  const LOCK_KEY = 'sexta_proactivity_tick_at';
  const ATTENTION_PRIORITY = 80;
  const INTERRUPT_PRIORITY = 95;
  let timer = null;
  let running = false;
  let ticks = 0;
  let triggers = 0;
  let interruptions = 0;
  let lastRunAt = '';
  let lastError = '';
  let voiceState = 'off';

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
      const fired = raw.map(classify);
      const urgent = fired.filter(item => item.delivery === 'urgent');
      const attention = fired.filter(item => item.delivery === 'attention');
      const silent = fired.filter(item => item.delivery === 'silent');
      triggers += fired.length;
      window.dispatchEvent(new CustomEvent('sexta:proactivity-tick', { detail: { ...data, fired, urgent, attention, silent } }));
      if (fired.length) window.dispatchEvent(new CustomEvent('sexta:proactive-event', { detail: { fired, urgent, attention, silent, at: lastRunAt } }));

      if (urgent.length) {
        interruptions += urgent.length;
        window.dispatchEvent(new CustomEvent('sexta:proactive-interrupt', {
          detail: { fired: urgent, at: lastRunAt, voiceState, reason: 'priority-threshold' }
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
    version: '1.1.0-priority-delivery',
    tick: () => tick({ force: true }),
    debug: () => ({ intervalMs: INTERVAL_MS, attentionPriority: ATTENTION_PRIORITY, interruptPriority: INTERRUPT_PRIORITY, voiceState, running, ticks, triggers, interruptions, lastRunAt, lastError })
  };
  schedule();
})();
