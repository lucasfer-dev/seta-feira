(() => {
  if (!('speechSynthesis' in window)) return;

  const synth = window.speechSynthesis;
  const nativeSpeak = synth.speak.bind(synth);
  const nativeCancel = synth.cancel.bind(synth);
  let activeAudio = null;
  let activeUrl = '';
  let controller = null;

  function stopGeminiAudio() {
    if (controller) {
      try { controller.abort(); } catch {}
      controller = null;
    }
    if (activeAudio) {
      try { activeAudio.pause(); } catch {}
      activeAudio.src = '';
      activeAudio = null;
    }
    if (activeUrl) {
      try { URL.revokeObjectURL(activeUrl); } catch {}
      activeUrl = '';
    }
  }

  async function geminiSpeak(utterance) {
    const text = String(utterance?.text || '').trim();
    if (!text) return;

    stopGeminiAudio();
    controller = new AbortController();

    try {
      const token = localStorage.getItem('sexta_token') || '';
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ text }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Gemini TTS ${response.status}`);
      const blob = await response.blob();
      activeUrl = URL.createObjectURL(blob);
      activeAudio = new Audio(activeUrl);
      activeAudio.preload = 'auto';
      activeAudio.onended = () => {
        stopGeminiAudio();
        try { utterance.onend?.({ type: 'end', utterance }); } catch {}
      };
      activeAudio.onerror = () => {
        stopGeminiAudio();
        try { utterance.onerror?.({ type: 'error', error: 'audio_playback', utterance }); } catch {}
      };
      try { utterance.onstart?.({ type: 'start', utterance }); } catch {}
      await activeAudio.play();
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('Gemini TTS indisponível; usando voz local.', error);
      stopGeminiAudio();
      nativeSpeak(utterance);
    }
  }

  try {
    synth.speak = utterance => { void geminiSpeak(utterance); };
    synth.cancel = () => {
      stopGeminiAudio();
      nativeCancel();
    };
    window.__sextaGeminiTts = true;
  } catch (error) {
    console.warn('Não consegui ativar o Gemini TTS; mantendo voz local.', error);
  }
})();
