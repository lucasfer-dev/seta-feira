(async () => {
  try {
    await import('./voice-core-v7.js');
    console.info('[SEXTA] Voice Core v7 carregado.');
  } catch (error) {
    console.error('[SEXTA] Voice Core v7 falhou; usando v6.', error);
    try {
      await import('./voice-core-v6.js');
    } catch (fallbackError) {
      console.error('[SEXTA] Voice Core fallback também falhou.', fallbackError);
      window.dispatchEvent(new CustomEvent('sexta:voice-state', {
        detail: { state: 'error', label: 'Não consegui iniciar o sistema de voz.' }
      }));
    }
  }
})();
