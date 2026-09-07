(() => {
  if (window.__sextaProactivity?.installed) return;
  const INTERVAL_MS = Math.max(30000, Number(window.SEXTA_PROACTIVITY_INTERVAL_MS || 60000));
  const LOCK_KEY = 'sexta_proactivity_tick_at';
  let timer = null;
  let running = false;
  let ticks = 0;
  let triggers = 0;
  let lastRunAt = '';
  let lastError = '';

  const token = () => localStorage.getItem('sexta_token') || '';
  function lockedByAnotherTab() {
    const last = Number(localStorage.getItem(LOCK_KEY) || 0);
    return Number.isFinite(last) && Date.now() - last < INTERVAL_MS * 0.82;
  }
  function acquire() { localStorage.setItem(LOCK_KEY, String(Date.now())); }
  async function tick({ force = false } = {}) {
    if (running || !token()) return null;
    if (!force && lockedByAnotherTab()) return null;
    running = true; acquire();
    try {
      const response = await fetch('/api/monitor/run', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: '{}' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
      ticks += 1; lastRunAt = new Date().toISOString(); lastError = '';
      const fired = Array.isArray(data?.results?.eventEngine?.triggered) ? data.results.eventEngine.triggered : [];
      triggers += fired.length;
      window.dispatchEvent(new CustomEvent('sexta:proactivity-tick', { detail: { ...data, fired } }));
      if (fired.length) {
        window.dispatchEvent(new CustomEvent('sexta:proactive-event', { detail: { fired, at: lastRunAt } }));
        if ('Notification' in window && Notification.permission === 'granted') {
          for (const item of fired.slice(0, 3)) {
            try { new Notification(item.name || 'SEXTA', { body: item?.notification?.body || item?.details?.title || 'Uma condição monitorada foi atendida.', icon: '/icon.svg' }); } catch {}
          }
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
  window.addEventListener('storage', event => { if (event.key === 'sexta_token' && event.newValue) void tick({ force: true }); });
  window.addEventListener('online', () => void tick());
  window.__sextaProactivity = {
    installed: true,
    version: '1.0.0',
    tick: () => tick({ force: true }),
    debug: () => ({ intervalMs: INTERVAL_MS, running, ticks, triggers, lastRunAt, lastError })
  };
  schedule();
})();
