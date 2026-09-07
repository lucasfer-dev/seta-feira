(() => {
  if (window.__sextaVoiceToolContext?.installed) return;

  const nativeFetch = window.fetch.bind(window);
  const context = { interim: '', final: '', activeTools: 0, lastTool: '', updatedAt: 0 };

  window.addEventListener('sexta:voice-transcript', event => {
    context.interim = String(event?.detail?.interim || '').trim();
    context.final = String(event?.detail?.final || '').trim();
    context.updatedAt = Date.now();
  });

  function isToolExecute(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return false;
    try {
      const url = new URL(raw, location.href);
      return url.pathname === '/api/tool-execute';
    } catch {
      return String(raw).includes('/api/tool-execute');
    }
  }

  window.fetch = async (input, init = {}) => {
    if (!isToolExecute(input) || typeof init?.body !== 'string') return nativeFetch(input, init);

    let body;
    try { body = JSON.parse(init.body); }
    catch { return nativeFetch(input, init); }

    const userText = String(body.userText || context.final || context.interim || '').trim();
    const tool = String(body.name || '').trim();
    const nextInit = userText
      ? { ...init, body: JSON.stringify({ ...body, userText }) }
      : init;

    context.activeTools += 1;
    context.lastTool = tool;
    window.dispatchEvent(new CustomEvent('sexta:tool-state', {
      detail: { phase: 'start', count: 1, tool, userTextAvailable: Boolean(userText) }
    }));

    try {
      return await nativeFetch(input, nextInit);
    } finally {
      context.activeTools = Math.max(0, context.activeTools - 1);
      window.dispatchEvent(new CustomEvent('sexta:tool-state', {
        detail: { phase: 'complete', count: 1, tool }
      }));
    }
  };

  window.__sextaVoiceToolContext = {
    installed: true,
    version: '1.0.0',
    debug: () => ({ ...context })
  };
})();
