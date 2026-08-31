(() => {
  const voiceBtn = document.querySelector('#voiceBtn');
  const wakeBtn = document.querySelector('#wakeBtn');
  const voiceHint = document.querySelector('#voiceHint');
  if (!voiceBtn || !navigator.mediaDevices?.getUserMedia || !window.WebSocket) return;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const INPUT_RATE = 16000;
  const OUTPUT_RATE = 24000;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const OUTPUT_PREBUFFER_SEC = IS_ANDROID ? 0.14 : 0.05;
  const OUTPUT_DRAIN_QUIET_MS = IS_ANDROID ? 260 : 140;
  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

  let websocket = null;
  let mediaStream = null;
  let inputContext = null;
  let inputSource = null;
  let processor = null;
  let silentGain = null;
  let outputContext = null;
  let nextOutputTime = 0;
  const outputSources = new Set();
  let outputChunkVersion = 0;
  let lastOutputChunkAt = 0;

  let sessionActive = false;
  let setupComplete = false;
  let captureEnabled = false;
  let assistantSpeaking = false;
  let finishingTurn = false;
  let handshakeTimeout = null;
  let inputTranscript = '';
  let outputTranscript = '';
  let stoppingByVoice = false;

  function setHint(text) {
    if (voiceHint) voiceHint.textContent = text;
  }

  function setActiveUI(active) {
    voiceBtn.classList.toggle('active', active);
    wakeBtn?.classList.toggle('active', active);
    voiceBtn.setAttribute('aria-pressed', String(active));
    if (wakeBtn) wakeBtn.setAttribute('aria-pressed', String(active));
  }

  function authHeaders(extra = {}) {
    const token = localStorage.getItem('sexta_token') || '';
    return { 'Content-Type': 'application/json', ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: authHeaders(options.headers || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Erro ${response.status}`);
    return data;
  }

  function normalizeSpeech(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isVoiceOffCommand(text) {
    const value = normalizeSpeech(text).replace(/^sexta(?: feira)?\s+/, '');
    return /^(?:desativar|desative|desliga|desligue|desligar|encerrar|encerre|fechar|fecha|pare|parar)\s+(?:o\s+)?modo\s+de\s+voz$/.test(value)
      || /^(?:sair|saia)\s+do\s+modo\s+de\s+voz$/.test(value)
      || /^(?:desativar|desative|desliga|desligue|desligar)\s+(?:a\s+)?voz$/.test(value);
  }

  function mergeTranscript(current, incoming) {
    const next = String(incoming || '').trim();
    if (!next) return current;
    if (!current) return next;
    if (next === current || current.endsWith(next)) return current;
    if (next.startsWith(current)) return next;
    return `${current} ${next}`.replace(/\s+/g, ' ').trim();
  }

  function floatToPcm16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i += 1) {
      const value = Math.max(-1, Math.min(1, float32[i]));
      out[i] = value < 0 ? value * 32768 : value * 32767;
    }
    return new Uint8Array(out.buffer);
  }

  function resampleLinear(input, fromRate, toRate) {
    if (fromRate === toRate) return input;
    const ratio = fromRate / toRate;
    const length = Math.max(1, Math.floor(input.length / ratio));
    const output = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const position = i * ratio;
      const left = Math.floor(position);
      const right = Math.min(input.length - 1, left + 1);
      const mix = position - left;
      output[i] = input[left] * (1 - mix) + input[right] * mix;
    }
    return output;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function pcm16ToFloat32(bytes) {
    const samples = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
    const floats = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      const sample = view.getInt16(i * 2, true);
      floats[i] = sample < 0 ? sample / 32768 : sample / 32767;
    }
    return floats;
  }

  async function ensureOutputContext() {
    if (!AudioContextCtor) throw new Error('Web Audio indisponível');
    if (!outputContext || outputContext.state === 'closed') {
      outputContext = new AudioContextCtor({ latencyHint: IS_ANDROID ? 'playback' : 'interactive', sampleRate: OUTPUT_RATE });
      outputContext.onstatechange = () => {
        if (sessionActive && assistantSpeaking && outputContext?.state === 'suspended') {
          void outputContext.resume().catch(() => {});
        }
      };
    }
    if (outputContext.state === 'suspended') await outputContext.resume();
    return outputContext;
  }

  async function scheduleOutput(base64, mimeType = '') {
    const bytes = base64ToBytes(base64);
    if (!bytes.length || !sessionActive) return;
    const match = String(mimeType).match(/rate=(\d+)/i);
    const sampleRate = Number(match?.[1] || OUTPUT_RATE);
    const ctx = await ensureOutputContext();
    const floats = pcm16ToFloat32(bytes);
    const buffer = ctx.createBuffer(1, floats.length, sampleRate);
    buffer.copyToChannel(floats, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    outputSources.add(source);
    outputChunkVersion += 1;
    lastOutputChunkAt = performance.now();
    source.onended = () => outputSources.delete(source);
    const now = ctx.currentTime;
    if (nextOutputTime < now + 0.015) nextOutputTime = now + OUTPUT_PREBUFFER_SEC;
    source.start(nextOutputTime);
    nextOutputTime += floats.length / sampleRate;
  }

  function stopOutput() {
    for (const source of outputSources) {
      try { source.stop(); } catch {}
    }
    outputSources.clear();
    outputChunkVersion += 1;
    lastOutputChunkAt = 0;
    nextOutputTime = 0;
    assistantSpeaking = false;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForOutputDrain() {
    const startedAt = performance.now();
    let seenVersion = outputChunkVersion;
    while (sessionActive && !stoppingByVoice && performance.now() - startedAt < 30000) {
      if (seenVersion !== outputChunkVersion) seenVersion = outputChunkVersion;
      let ctx = outputContext;
      try { ctx = await ensureOutputContext(); } catch {}
      const scheduledTail = ctx ? Math.max(0, nextOutputTime - ctx.currentTime) : 0;
      const quietFor = lastOutputChunkAt ? performance.now() - lastOutputChunkAt : OUTPUT_DRAIN_QUIET_MS;
      if (outputSources.size === 0 && scheduledTail <= 0.025 && quietFor >= OUTPUT_DRAIN_QUIET_MS) return;
      await sleep(35);
    }
  }

  function sendRealtime(payload) {
    if (websocket?.readyState === WebSocket.OPEN && setupComplete && sessionActive) {
      websocket.send(JSON.stringify({ realtimeInput: payload }));
    }
  }

  async function startMicrophone() {
    if (mediaStream) {
      captureEnabled = true;
      setHint('Gemini Live • ouvindo...');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    inputContext = new AudioContextCtor({ latencyHint: 'interactive' });
    if (inputContext.state === 'suspended') await inputContext.resume();
    inputSource = inputContext.createMediaStreamSource(mediaStream);
    processor = inputContext.createScriptProcessor(2048, 1, 1);
    silentGain = inputContext.createGain();
    silentGain.gain.value = 0;

    processor.onaudioprocess = event => {
      if (!sessionActive || !captureEnabled || assistantSpeaking || finishingTurn || websocket?.readyState !== WebSocket.OPEN || !setupComplete) return;
      const raw = event.inputBuffer.getChannelData(0);
      const resampled = resampleLinear(raw, inputContext.sampleRate, INPUT_RATE);
      const pcm = floatToPcm16(resampled);
      sendRealtime({ audio: { data: bytesToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_RATE}` } });
    };

    inputSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(inputContext.destination);
    captureEnabled = true;
    setHint('Gemini Live • ouvindo...');
  }

  function stopMicrophone() {
    captureEnabled = false;
    try { processor?.disconnect(); } catch {}
    try { inputSource?.disconnect(); } catch {}
    try { silentGain?.disconnect(); } catch {}
    try { if (processor) processor.onaudioprocess = null; } catch {}
    for (const track of mediaStream?.getTracks?.() || []) track.stop();
    try { inputContext?.close(); } catch {}
    mediaStream = null;
    inputContext = null;
    inputSource = null;
    processor = null;
    silentGain = null;
  }

  async function buildSystemInstruction() {
    const conversationId = localStorage.getItem('sexta_conversation') || 'main';
    let sync = {};
    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}`); } catch {}
    const settings = sync.settings || {};
    const memories = (sync.memories || []).slice(0, 10).map(item => `- ${item.content}`).join('\n');
    const recent = (sync.messages || []).slice(-6).map(item => `${item.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${item.content}`).join('\n');

    return [
      'Você é SEXTA-feira, uma assistente pessoal de voz. Fale sempre em português brasileiro natural e conversacional.',
      'Fale de forma próxima, humana e confiante. Responda de forma curta por padrão.',
      'O modo de voz é contínuo: depois de responder, aguarde naturalmente o próximo pedido sem encerrar a conversa.',
      'Se o usuário disser para desativar, desligar, encerrar ou sair do modo de voz, não continue a resposta; o aplicativo encerrará a sessão localmente.',
      `Ajustes: humor ${settings.humor ?? 68}/100, sarcasmo ${settings.sarcasm ?? 42}/100, proatividade ${settings.proactivity ?? 55}/100, verbosidade ${settings.verbosity ?? 32}/100.`,
      'Nunca afirme que uma ação externa foi executada sem confirmação real de uma ferramenta.',
      memories ? `Memórias relevantes:\n${memories}` : '',
      recent ? `Contexto recente:\n${recent}` : ''
    ].filter(Boolean).join('\n\n');
  }

  async function persistTurn(userText, assistantText) {
    const cleanUser = String(userText || '').replace(/\s+/g, ' ').trim();
    const cleanAssistant = String(assistantText || '').replace(/\s+/g, ' ').trim();
    if (!cleanUser && !cleanAssistant) return;
    try {
      await api('/api/live-turn', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: localStorage.getItem('sexta_conversation') || 'main',
          deviceId: localStorage.getItem('sexta_device_id') || 'live-browser',
          userText: cleanUser,
          assistantText: cleanAssistant
        })
      });
      document.querySelector('#syncBtn')?.click();
    } catch (error) {
      console.warn('Não consegui salvar o turno Live:', error);
    }
  }

  function resetTurnTranscripts() {
    inputTranscript = '';
    outputTranscript = '';
  }

  async function finishCurrentTurn() {
    if (!sessionActive || stoppingByVoice || finishingTurn) return;
    finishingTurn = true;
    captureEnabled = false;
    try {
      await waitForOutputDrain();
      if (!sessionActive || stoppingByVoice) return;
      const userText = inputTranscript;
      const assistantText = outputTranscript;
      resetTurnTranscripts();
      void persistTurn(userText, assistantText);
      assistantSpeaking = false;
      captureEnabled = true;
      setHint('Gemini Live • ouvindo...');
    } finally {
      finishingTurn = false;
    }
  }

  function cleanupSession(closeSocket = true) {
    sessionActive = false;
    setupComplete = false;
    captureEnabled = false;
    assistantSpeaking = false;
    finishingTurn = false;
    setActiveUI(false);
    if (handshakeTimeout) clearTimeout(handshakeTimeout);
    handshakeTimeout = null;
    stopMicrophone();
    stopOutput();
    if (closeSocket && websocket) {
      try { websocket.close(1000, 'voice mode off'); } catch {}
    }
    websocket = null;
    resetTurnTranscripts();
  }

  function deactivateVoiceMode({ spoken = false } = {}) {
    if (!sessionActive) return;
    stoppingByVoice = spoken;
    const userText = inputTranscript;
    if (spoken && userText) void persistTurn(userText, '');
    cleanupSession(true);
    setHint(spoken ? 'Modo de voz desativado' : 'Gemini Live pronto');
    stoppingByVoice = false;
  }

  async function handleServerMessage(event) {
    let raw = event.data;
    if (raw instanceof Blob) raw = await raw.text();
    if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);

    let message;
    try { message = JSON.parse(raw); }
    catch (error) {
      console.warn('Mensagem Live não-JSON:', raw, error);
      return;
    }

    if (message.setupComplete) {
      setupComplete = true;
      if (handshakeTimeout) clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
      setHint('Gemini Live conectado • abrindo microfone...');
      try {
        await startMicrophone();
      } catch (error) {
        console.error('Microfone Live:', error);
        setHint(`Microfone indisponível • ${error?.name || 'erro'}`);
        cleanupSession(true);
      }
      return;
    }

    const content = message.serverContent;
    if (content?.inputTranscription?.text) {
      const incoming = content.inputTranscription.text;
      inputTranscript = mergeTranscript(inputTranscript, incoming);
      if (isVoiceOffCommand(incoming) || isVoiceOffCommand(inputTranscript)) {
        deactivateVoiceMode({ spoken: true });
        return;
      }
    }
    if (content?.outputTranscription?.text) {
      outputTranscript = mergeTranscript(outputTranscript, content.outputTranscription.text);
    }

    const interrupted = Boolean(content?.interrupted);
    const parts = content?.modelTurn?.parts || [];
    for (const part of parts) {
      if (!part?.inlineData?.data || !sessionActive) continue;
      assistantSpeaking = true;
      captureEnabled = false;
      setHint('Gemini Live • falando...');
      await scheduleOutput(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
    }

    if (interrupted) {
      // Android/echo can cause a false interruption right at the speaker transition.
      // Never throw away audio already buffered; drain it before reopening the mic.
      if (assistantSpeaking || outputSources.size > 0) {
        captureEnabled = false;
        setHint('Gemini Live • finalizando fala...');
        void finishCurrentTurn();
      } else {
        assistantSpeaking = false;
        captureEnabled = true;
        setHint('Gemini Live • ouvindo...');
      }
      return;
    }

    if (content?.turnComplete) void finishCurrentTurn();
  }

  async function activateVoiceMode() {
    if (sessionActive) return;
    if (!AudioContextCtor) {
      setHint('Web Audio indisponível');
      return;
    }

    sessionActive = true;
    setupComplete = false;
    captureEnabled = false;
    assistantSpeaking = false;
    finishingTurn = false;
    stoppingByVoice = false;
    resetTurnTranscripts();
    nextOutputTime = 0;
    outputChunkVersion = 0;
    lastOutputChunkAt = 0;
    setActiveUI(true);
    setHint('Preparando Gemini Live...');

    try {
      const systemInstruction = await buildSystemInstruction();
      if (!sessionActive) return;

      const session = await api('/api/live-token', {
        method: 'POST',
        body: JSON.stringify({ systemInstruction })
      });
      if (!session?.token) throw new Error('token Live vazio');
      if (!sessionActive) return;

      setHint('Conectando Gemini Live...');
      const wsUrl = `${WS_BASE}?access_token=${encodeURIComponent(session.token)}`;
      websocket = new WebSocket(wsUrl);

      websocket.onopen = () => {
        if (!sessionActive) return;
        setHint('Gemini Live conectado • validando sessão...');
        websocket.send(JSON.stringify({
          setup: {
            model: `models/${session.model}`,
            generationConfig: { responseModalities: ['AUDIO'] }
          }
        }));
      };

      websocket.onmessage = event => { void handleServerMessage(event); };
      websocket.onerror = event => {
        if (!sessionActive) return;
        console.warn('Gemini Live WebSocket error:', event);
        setHint('Gemini Live • erro de conexão');
      };
      websocket.onclose = event => {
        if (!sessionActive) return;
        const code = event?.code || 0;
        const reason = String(event?.reason || '').trim();
        console.warn('Gemini Live fechado:', code, reason);
        cleanupSession(false);
        setHint(reason ? `Live fechado ${code} • ${reason.slice(0, 70)}` : `Live fechado • código ${code}`);
      };

      handshakeTimeout = setTimeout(() => {
        if (sessionActive && !setupComplete) {
          setHint('Gemini Live • timeout no handshake');
          cleanupSession(true);
        }
      }, 12_000);
    } catch (error) {
      console.error('Gemini Live:', error);
      cleanupSession(true);
      setHint(`Gemini Live indisponível • ${String(error?.message || error).slice(0, 100)}`);
    }
  }

  function toggleVoiceMode() {
    if (sessionActive) deactivateVoiceMode();
    else void activateVoiceMode();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionActive && assistantSpeaking) void ensureOutputContext().catch(() => {});
  });

  voiceBtn.onclick = toggleVoiceMode;
  voiceBtn.title = 'Ativar/desativar modo de voz contínuo';
  if (wakeBtn) {
    wakeBtn.onclick = toggleVoiceMode;
    wakeBtn.title = 'Ativar/desativar modo de voz contínuo';
  }
  setHint('Gemini Live pronto');
  window.__sextaGeminiLive = {
    start: activateVoiceMode,
    stop: () => deactivateVoiceMode(),
    toggle: toggleVoiceMode,
    active: () => sessionActive
  };
})();
