(async () => {
  try {
    await import('./voice-core-v6.js');
    console.info('[SEXTA] Voice Core v6 carregado.');
  } catch (error) {
    console.error('[SEXTA] Voice Core v6 falhou; usando v5.', error);
    try {
      await import('./voice-core-v5.js');
    } catch (fallbackError) {
      console.error('[SEXTA] Voice Core fallback também falhou.', fallbackError);
      window.dispatchEvent(new CustomEvent('sexta:voice-state', {
        detail: { state: 'error', label: 'Não consegui iniciar o sistema de voz.' }
      }));
    }
  }
})();
