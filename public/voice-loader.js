(async () => {
  try {
    await import('./voice-core-v9.js');
    console.info('[SEXTA] Voice Core v9 / Gemini 3.1 carregado.');
  } catch (error) {
    console.error('[SEXTA] Voice Core v9 falhou; usando v8 legado.', error);
    try {
      await import('./voice-core-v8.js');
    } catch (fallbackError) {
      console.error('[SEXTA] Voice Core fallback também falhou.', fallbackError);
      window.dispatchEvent(new CustomEvent('sexta:voice-state', {
        detail: { state: 'error', label: 'Não consegui iniciar o sistema de voz.' }
      }));
    }
  }
})();
