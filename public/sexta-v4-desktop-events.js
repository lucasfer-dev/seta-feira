(() => {
  if (window.__sextaV4DesktopEvents) return;
  window.addEventListener('sexta:open-agent-control', () => {
    window.__sextaV4System?.open?.();
  });
  window.__sextaV4DesktopEvents = true;
})();
