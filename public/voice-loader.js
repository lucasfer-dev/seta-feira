(async () => {
  try {
    await import('./voice-core-v10.js');
    document.documentElement.dataset.voiceCore = 'v10';
    console.info('[SEXTA] Voice Core v10 carregado.');
  } catch (error) {
    console.error('[SEXTA] Voice Core v10 falhou.', error);
    document.documentElement.dataset.voiceCore = 'v10-error';
    window.dispatchEvent(new CustomEvent('sexta:voice-state', {
      detail: { state: 'error', label: 'Não consegui iniciar o sistema de voz.' }
    }));
  }
})();
