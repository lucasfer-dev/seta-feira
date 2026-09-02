(() => {
  if (!('speechSynthesis' in window)) return;

  const synth = window.speechSynthesis;
  const nativeCancel = synth.cancel.bind(synth);
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const QUOTA_WINDOW_MS = 60_000;
  const SAFE_REQUESTS_PER_WINDOW = 9;
  const QUOTA_KEY = 'sexta_gemini_tts_request_times';

  let controller = null;
  let audioContext = null;
  let activeSources = new Set();
  let playbackGeneration = 0;

  function setVoiceHint(text) {
    const el = document.querySelector('#voiceHint');
    if (el) el.textContent = text;
  }

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

  function recentRequestTimes() {
    const now = Date.now();
    let times = [];
    try { times = JSON.parse(localStorage.getItem(QUOTA_KEY) || '[]'); } catch {}
    return times.filter(value => Number.isFinite(value) && now - value < QUOTA_WINDOW_MS).sort((a, b) => a - b);
  }

  function reserveQuotaSlot() {
    const now = Date.now();
    const times = recentRequestTimes();
    if (times.length < SAFE_REQUESTS_PER_WINDOW) {
      times.push(now);
      localStorage.setItem(QUOTA_KEY, JSON.stringify(times));
      return 0;
    }
    return Math.max(300, times[0] + QUOTA_WINDOW_MS - now + 350);
  }

  async function waitForQuota(generation) {
    while (generation === playbackGeneration) {
      const waitMs = reserveQuotaSlot();
      if (!waitMs) return true;
      setVoiceHint(`voz aguardando ${Math.max(1, Math.ceil(waitMs / 1000))}s`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    return false;
  }

  function parseRetryMs(message = '') {
    const match = String(message).match(/retry in\s+([\d.]+)s/i);
    return match ? Math.ceil(Number(match[1]) * 1000) + 500 : 8_000;
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

  async function ttsFetch(text, stream, generation) {
    if (!(await waitForQuota(generation))) throw Object.assign(new Error('cancelled'), { cancelled: true });
    if (generation !== playbackGeneration) throw Object.assign(new Error('cancelled'), { cancelled: true });

    let personality = {};
    try { personality = JSON.parse(localStorage.getItem('sexta_personality') || '{}'); } catch {}
    controller = new AbortController();
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ text, stream, personality }),
      signal: controller.signal
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.message || `Gemini TTS ${response.status}`);
      error.status = response.status;
      error.retryMs = response.status === 429 ? parseRetryMs(data.message) : 0;
      throw error;
    }
    return response;
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
          setVoiceHint('falando...');
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
        setVoiceHint('Voz pronta');
        try { utterance.onend?.({ type: 'end', utterance }); } catch {}
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  async function playBufferedGemini(text, utterance, generation) {
    const response = await ttsFetch(text, false, generation);
    if (generation !== playbackGeneration) return;

    const wav = await response.arrayBuffer();
    if (generation !== playbackGeneration) return;
    const ctx = await ensureAudioContext(24000);
    const decoded = await ctx.decodeAudioData(wav.slice(0));
    if (generation !== playbackGeneration) return;

    setVoiceHint('falando...');
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
      setVoiceHint('Voz pronta');
      try { utterance.onend?.({ type: 'end', utterance }); } catch {}
    }
  }

  async function geminiSpeak(utterance) {
    const text = String(utterance?.text || '').trim();
    if (!text) return;

    stopGeminiAudio();
    let generation = playbackGeneration;

    try {
      let response;
      while (generation === playbackGeneration) {
        try {
          response = await ttsFetch(text, true, generation);
          break;
        } catch (error) {
          if (error?.cancelled || error?.name === 'AbortError' || generation !== playbackGeneration) return;
          if (error?.status !== 429) throw error;
          const retryMs = Math.max(1_000, error.retryMs || 8_000);
          setVoiceHint(`Gemini ocupado • ${Math.ceil(retryMs / 1000)}s`);
          await new Promise(resolve => setTimeout(resolve, retryMs));
        }
      }

      if (!response || generation !== playbackGeneration) return;
      if (response.headers.get('X-SEXTA-TTS-Stream') !== 'pcm-s16le') {
        throw new Error('Servidor não ativou streaming PCM');
      }
      await playPcmStream(response, utterance, generation);
    } catch (error) {
      if (error?.cancelled || error?.name === 'AbortError' || generation !== playbackGeneration) return;
      console.warn('Streaming Gemini indisponível; tentando a mesma voz Gemini em áudio completo.', error);

      stopGeminiAudio();
      generation = playbackGeneration;
      try {
        await playBufferedGemini(text, utterance, generation);
      } catch (fallbackError) {
        if (fallbackError?.cancelled || fallbackError?.name === 'AbortError' || generation !== playbackGeneration) return;
        if (fallbackError?.status === 429) {
          const retryMs = Math.max(1_000, fallbackError.retryMs || 8_000);
          setVoiceHint(`Gemini ocupado • ${Math.ceil(retryMs / 1000)}s`);
          await new Promise(resolve => setTimeout(resolve, retryMs));
          if (generation === playbackGeneration) void geminiSpeak(utterance);
          return;
        }
        setVoiceHint('Gemini sem voz agora');
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
    window.__sextaGeminiTts = 'gemini-only-quota-aware';
  } catch (error) {
    console.error('Não consegui ativar a voz Gemini da SEXTA.', error);
  }
})();
