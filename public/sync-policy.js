(() => {
  const nativeSetInterval = window.setInterval.bind(window);
  const syncHint = () => document.querySelector('#syncHint');

  window.setInterval = (handler, timeout, ...args) => {
    const delay = Number(timeout || 0);
    const source = typeof handler === 'function' ? Function.prototype.toString.call(handler) : String(handler || '');

    // app-original historically performs a complete /api/sync snapshot every 5 s.
    // That snapshot reads messages, memories, devices, events, notifications and
    // settings, then re-renders the whole UI. Voice sessions already fetch fresh
    // context when they start, so keep cross-device handoff session-scoped instead.
    if (delay === 5000 && /sync\s*\(\s*\{\s*silent\s*:\s*true\s*\}\s*\)/.test(source)) {
      console.info('[SEXTA Sync] full polling de 5 s desativado; sync por sessão ativo.');
      return 0;
    }

    return nativeSetInterval(handler, timeout, ...args);
  };

  function labelSessionSync() {
    const el = syncHint();
    if (!el) return;
    const match = String(el.textContent || '').match(/sincronizado\s+(.+)$/i);
    if (match) el.textContent = `sessão sincronizada ${match[1]}`;
  }

  window.addEventListener('load', () => {
    setTimeout(labelSessionSync, 250);
    const el = syncHint();
    if (el) new MutationObserver(labelSessionSync).observe(el, { childList: true, subtree: true, characterData: true });
  }, { once: true });
})();
