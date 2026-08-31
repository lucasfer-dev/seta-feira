(() => {
  if (!('speechSynthesis' in window)) return;

  const synth = window.speechSynthesis;
  const nativeCancel = synth.cancel.bind(synth);
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

  let controller = null;
  let audioContext = null;
  let activeSources = new Set();
  let playbackGeneration = 0;

  function stopGeminiAudio() {
    playbackGeneration += 1;
    if (controller) {
      try { controller.abort(); } catch {}
      controller = null;
    }
    for (const source of activeSources) {
      try { source.stop(); } catch {}
    }
    activeSources.clear();
  }

  async function ensureAudioContext(sampleRate = 24000) {
    if (!AudioContextCtor) throw new Error('Web Audio API indisponível');
    if (!audioContext || audioContext.state === 'closed') {
      audioContext = new AudioContextCtor({ latencyHint: 'interactive', sampleRate });
    }
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
  }

  function authHeaders() {
    const token = localStorage.getItem('sexta_token') || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function combineBytes(a, b) {
    if (!a?.length) return b;
    if (!b?.length) return a;
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  }

  function pcm16ToFloat32(bytes) {
    const sampleCount = Math.floor(bytes.byteLength / 2);
    const output = new Float32Array(sampleCount);
    const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
    for (let i = 0; i < sampleCount; i += 1) {
      const sample = view.getInt16(i * 2, true);
      output[i] = sample < 0 ? sample / 32768 : sample / 32767;
    }
    return output;
  }

  async function playPcmStream(response, utterance, generation) {
    if (!response.body) throw new Error('Streaming de áudio indisponível');

    const sampleRate = Number(response.headers.get('X-SEXTA-TTS-Sample-Rate') || 24000);
    const ctx = await ensureAudioContext(sampleRate);
    const reader = response.body.getReader();
    let carry = new Uint8Array(0);
    let nextStart = 0;
    let started = false;
    let scheduledEnd = 0;

    try {
      while (true) {
        if (generation !== playbackGeneration) return;
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;

        const bytes = combineBytes(carry, value);
        const usableLength = bytes.length - (bytes.length % 2);
        carry = usableLength < bytes.length ? bytes.slice(usableLength) : new Uint8Array(0);
        if (!usableLength) continue;

        const floats = pcm16ToFloat32(bytes.subarray(0, usableLength));
        if (!floats.length) continue;

        const buffer = ctx.createBuffer(1, floats.length, sampleRate);
        buffer.copyToChannel(floats, 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        activeSources.add(source);
        source.onended = () => activeSources.delete(source);

        const now = ctx.currentTime;
        if (!started) {
          nextStart = now + 0.045;
          started = true;
          try { utterance.onstart?.({ type: 'start', utterance }); } catch {}
        } else if (nextStart < now + 0.012) {
          nextStart = now + 0.012;
        }

        source.start(nextStart);
        nextStart += floats.length / sampleRate;
        scheduledEnd = nextStart;
      }

      if (!started) throw new Error('Gemini TTS não retornou áudio');
      const waitMs = Math.max(0, (scheduledEnd - ctx.currentTime) * 1000) + 20;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      if (generation === playbackGeneration) {
        try { utterance.onend?.({ type: 'end', utterance }); } catch {}
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  async function playBufferedGemini(text, utterance, generation) {
    controller = new AbortController();
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text, stream: false }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Gemini TTS ${response.status}`);
    if (generation !== playbackGeneration) return;

    const wav = await response.arrayBuffer();
    if (generation !== playbackGeneration) return;
    const ctx = await ensureAudioContext(24000);
    const decoded = await ctx.decodeAudioData(wav.slice(0));
    if (generation !== playbackGeneration) return;

    await new Promise((resolve, reject) => {
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      source.connect(ctx.destination);
      activeSources.add(source);
      source.onended = () => {
        activeSources.delete(source);
        resolve();
      };
      try {
        utterance.onstart?.({ type: 'start', utterance });
        source.start();
      } catch (error) {
        activeSources.delete(source);
        reject(error);
      }
    });

    if (generation === playbackGeneration) {
      try { utterance.onend?.({ type: 'end', utterance }); } catch {}
    }
  }

  async function geminiSpeak(utterance) {
    const text = String(utterance?.text || '').trim();
    if (!text) return;

    stopGeminiAudio();
    let generation = playbackGeneration;
    controller = new AbortController();

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text, stream: true }),
        signal: controller.signal
      });

      if (!response.ok) throw new Error(`Gemini TTS ${response.status}`);
      if (response.headers.get('X-SEXTA-TTS-Stream') !== 'pcm-s16le') {
        throw new Error('Servidor não ativou streaming PCM');
      }
      await playPcmStream(response, utterance, generation);
    } catch (error) {
      if (error?.name === 'AbortError' || generation !== playbackGeneration) return;
      console.warn('Gemini TTS streaming indisponível; tentando Gemini TTS completo.', error);

      stopGeminiAudio();
      generation = playbackGeneration;
      try {
        await playBufferedGemini(text, utterance, generation);
      } catch (fallbackError) {
        if (fallbackError?.name === 'AbortError' || generation !== playbackGeneration) return;
        console.error('Gemini TTS indisponível. A SEXTA não usará voz robótica.', fallbackError);
        try { utterance.onerror?.({ type: 'error', error: 'gemini_tts_unavailable', utterance }); } catch {}
      }
    } finally {
      if (generation === playbackGeneration) controller = null;
    }
  }

  try {
    synth.speak = utterance => { void geminiSpeak(utterance); };
    synth.cancel = () => {
      stopGeminiAudio();
      nativeCancel();
    };
    window.__sextaGeminiTts = 'gemini-only-streaming';
  } catch (error) {
    console.error('Não consegui ativar a voz Gemini da SEXTA.', error);
  }
})();
