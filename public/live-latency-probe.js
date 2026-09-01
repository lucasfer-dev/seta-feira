(() => {
  // Compatibilidade com versões anteriores do app.js.
  // Este arquivo NÃO intercepta WebSocket nem envia activityStart/activityEnd.
  // A telemetria segura permanece em live-voice-v3.js.
  window.__sextaLatencyProbeInstalled = false;
  window.__sextaLatency = window.__sextaLatency || {
    last: () => null,
    platform: /Android/i.test(navigator.userAgent) ? 'android' : 'browser'
  };
})();
