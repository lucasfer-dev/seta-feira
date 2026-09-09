(() => {
  if (window.__sextaV4DesktopEvents) return;

  const desktop = window.sextaDesktop;

  function submitPrompt(text) {
    const value = String(text || '').trim();
    if (!value) return false;
    document.body.classList.remove('sexta-v4-panel-open', 'sexta-manual-chat');
    document.querySelector('.nav-item[data-view="chat"]')?.click();
    const input = document.querySelector('#messageInput');
    const form = document.querySelector('#composer');
    if (!input || !form) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit?.();
    return true;
  }

  function toggleVoice(attempt = 0) {
    const live = window.__sextaGeminiLive;
    if (live) {
      live.active?.() ? live.stop?.() : live.start?.();
      return true;
    }
    if (attempt < 10) setTimeout(() => toggleVoice(attempt + 1), 180);
    return false;
  }

  function openPalette() {
    document.body.classList.remove('sexta-v4-panel-open', 'sexta-manual-chat');
    window.__sextaV4?.openCommands?.();
  }

  window.addEventListener('sexta:open-agent-control', () => {
    window.__sextaV4System?.open?.();
  });

  desktop?.habitat?.onCommand?.(detail => {
    submitPrompt(detail?.text || '');
  });

  desktop?.habitat?.onVoiceToggle?.(() => {
    toggleVoice();
  });

  desktop?.habitat?.onOpenPalette?.(() => {
    openPalette();
  });

  window.__sextaV4DesktopEvents = {
    submitPrompt,
    toggleVoice,
    openPalette
  };
})();
