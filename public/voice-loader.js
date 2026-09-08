(async () => {
  try {
    await import('./voice-reliability-v10-1.js');
    await import('./voice-barge-in-guard.js');
    await import('./voice-output-jitter-guard.js');
    await import('./presence-engine.js');
    await import('./presence-orb-lite.js');
    await import('./voice-tool-context.js');
    await import('./voice-core-v10.js');
    document.documentElement.dataset.voiceCore = 'v10.1-reliable-smart-barge-jitter';
    console.info('[SEXTA] Voice Core v10 + Reliability v10.1 + Smart Barge-In + Jitter Guard + Presence Engine/Orb + Tool Context carregados.');
  } catch (error) {
    console.error('[SEXTA] Voice Core v10 falhou.', error);
    document.documentElement.dataset.voiceCore = 'v10.1-reliable-smart-barge-jitter-error';
    window.dispatchEvent(new CustomEvent('sexta:voice-state', {
      detail: { state: 'error', label: 'Não consegui iniciar o sistema de voz.' }
    }));
  }
})();
