(() => {
  const voiceBtn = document.querySelector('#voiceBtn');
  const wakeBtn = document.querySelector('#wakeBtn');
  const voiceHint = document.querySelector('#voiceHint');
  if (!voiceBtn || !navigator.mediaDevices?.getUserMedia || !window.WebSocket) return;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const INPUT_RATE = 16000;
  const OUTPUT_RATE = 24000;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const IS_DESKTOP = /Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop);
  const ORIGIN = IS_ANDROID ? 'android' : IS_DESKTOP ? 'desktop' : 'browser';
  const OUTPUT_PREBUFFER_BASE = IS_ANDROID ? 0.18 : 0.07;
  const OUTPUT_PREBUFFER_MAX = IS_ANDROID ? 0.34 : 0.20;
  const OUTPUT_DRAIN_QUIET_MS = IS_ANDROID ? 220 : 130;
  const CLIENT_END_SILENCE_MS = IS_ANDROID ? 620 : 560;
  const BARGE_MIN_RMS = IS_ANDROID ? 0.040 : 0.028;
  const BARGE_FRAMES_REQUIRED = 3;
  const PRE_SPEECH_FRAMES = 5;
  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

  let websocket = null;
  let mediaStream = null;
  let inputContext = null;
  let inputSource = null;
  let processor = null;
  let silentGain = null;
  let outputContext = null;
  let nextOutputTime = 0;
  let adaptivePrebuffer = OUTPUT_PREBUFFER_BASE;
  let outputUnderruns = 0;
  const outputSources = new Set();
  let lastOutputChunkAt = 0;

  let sessionActive = false;
  let setupComplete = false;
  let captureEnabled = false;
  let assistantSpeaking = false;
  let finishingTurn = false;
  let stoppingByVoice = false;
  let handshakeTimeout = null;
  let inputTranscript = '';
  let outputTranscript = '';
  let pendingToolCalls = 0;

  let speechActive = false;
  let lastSpeechAt = 0;
  let lastSpeechEndAt = 0;
  let audioStreamOpen = false;
  let assistantInputPaused = false;
  let noiseFloor = 0.006;
  let bargeFrames = 0;
  let preSpeech = [];

  let turnStartedAt = 0;
  let firstServerEventAt = 0;
  let firstAudioAt = 0;
  let turnUnderrunsAtStart = 0;

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
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[.,!?;:]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  async function ensureOutputContext() {
    if (!AudioContextCtor) throw new Error('Web Audio indisponível');
    if (!outputContext || outputContext.state === 'closed') {
      outputContext = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: OUTPUT_RATE });
      outputContext.onstatechange = () => {
        if (sessionActive && outputContext?.state === 'suspended' && !document.hidden) {
          void outputContext.resume().catch(() => {});
        }
      };
    }
    if (outputContext.state === 'suspended' && !document.hidden) await outputContext.resume();
    return outputContext;
  }

  function sendRealtime(payload) {
    if (websocket?.readyState === WebSocket.OPEN && setupComplete && sessionActive) {
      websocket.send(JSON.stringify({ realtimeInput: payload }));
    }
  }

  function endAudioStream() {
    if (!audioStreamOpen || !sessionActive || !setupComplete) return;
    sendRealtime({ audioStreamEnd: true });
    audioStreamOpen = false;
    lastSpeechEndAt = performance.now();
  }

  function sendPcm(pcm) {
    if (!pcm?.length || !sessionActive || !setupComplete) return;
    audioStreamOpen = true;
    sendRealtime({ audio: { data: bytesToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_RATE}` } });
  }

  function pauseInputForAssistant() {
    if (assistantInputPaused) return;
    assistantInputPaused = true;
    speechActive = false;
    bargeFrames = 0;
    preSpeech = [];
    endAudioStream();
  }

  function stopOutput() {
    for (const source of outputSources) {
      try { source.stop(); } catch {}
    }
    outputSources.clear();
    nextOutputTime = 0;
    lastOutputChunkAt = 0;
    assistantSpeaking = false;
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
    source.onended = () => outputSources.delete(source);

    const now = ctx.currentTime;
    const recentChunk = lastOutputChunkAt && performance.now() - lastOutputChunkAt < 900;
    const wouldUnderrun = nextOutputTime > 0 && nextOutputTime < now + 0.008 && recentChunk;
    if (wouldUnderrun) {
      outputUnderruns += 1;
      adaptivePrebuffer = Math.min(OUTPUT_PREBUFFER_MAX, adaptivePrebuffer + 0.028);
    }

    if (nextOutputTime < now + 0.012) nextOutputTime = now + adaptivePrebuffer;
    source.start(nextOutputTime);
    nextOutputTime += floats.length / sampleRate;
    lastOutputChunkAt = performance.now();
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function waitForOutputDrain() {
    const startedAt = performance.now();
    while (sessionActive && !stoppingByVoice && performance.now() - startedAt < 20000) {
      let ctx = outputContext;
      try { ctx = await ensureOutputContext(); } catch {}
      const scheduledTail = ctx ? Math.max(0, nextOutputTime - ctx.currentTime) : 0;
      const quietFor = lastOutputChunkAt ? performance.now() - lastOutputChunkAt : OUTPUT_DRAIN_QUIET_MS;
      if (outputSources.size === 0 && scheduledTail <= 0.02 && quietFor >= OUTPUT_DRAIN_QUIET_MS) return;
      await sleep(24);
    }
  }

  function sendToolResponse(functionResponses) {
    if (websocket?.readyState !== WebSocket.OPEN || !setupComplete || !sessionActive) return;
    websocket.send(JSON.stringify({ toolResponse: { functionResponses } }));
  }

  function pushPreSpeech(pcm) {
    preSpeech.push(pcm);
    if (preSpeech.length > PRE_SPEECH_FRAMES) preSpeech.shift();
  }

  function speechThreshold() { return Math.max(IS_ANDROID ? 0.012 : 0.009, noiseFloor * 3.0); }

  function updateNoiseFloor(level) {
    const maxQuiet = IS_ANDROID ? 0.025 : 0.018;
    if (level <= maxQuiet) noiseFloor = noiseFloor * 0.985 + level * 0.015;
  }

  function beginUserSpeechFromBuffer(now) {
    speechActive = true;
    lastSpeechAt = now;
    if (!turnStartedAt) {
      turnStartedAt = performance.now();
      turnUnderrunsAtStart = outputUnderruns;
    }
    const buffered = preSpeech;
    preSpeech = [];
    for (const frame of buffered) sendPcm(frame);
  }

  function handleMicFrame(raw) {
    if (!sessionActive || !captureEnabled || websocket?.readyState !== WebSocket.OPEN || !setupComplete) return;
    const resampled = resampleLinear(raw, inputContext.sampleRate, INPUT_RATE);
    const pcm = floatToPcm16(resampled);
    const level = rms(raw);
    const now = performance.now();

    if (assistantSpeaking) {
      pushPreSpeech(pcm);
      const threshold = Math.max(BARGE_MIN_RMS, noiseFloor * 4.5);
      if (level >= threshold) bargeFrames += 1;
      else bargeFrames = Math.max(0, bargeFrames - 1);

      if (bargeFrames >= BARGE_FRAMES_REQUIRED) {
        stopOutput();
        assistantInputPaused = false;
        bargeFrames = 0;
        beginUserSpeechFromBuffer(now);
        setHint('SEXTA • ouvindo...');
      }
      return;
    }

    assistantInputPaused = false;
    updateNoiseFloor(level);
    const threshold = speechThreshold();
    pushPreSpeech(pcm);

    if (level >= threshold) {
      if (!speechActive) beginUserSpeechFromBuffer(now);
      else sendPcm(pcm);
      lastSpeechAt = now;
      return;
    }

    if (speechActive) {
      sendPcm(pcm);
      if (now - lastSpeechAt >= CLIENT_END_SILENCE_MS) {
        speechActive = false;
        endAudioStream();
        preSpeech = [];
        setHint('SEXTA • pensando...');
      }
    }
  }

  async function startMicrophone() {
    if (mediaStream) {
      captureEnabled = true;
      setHint('SEXTA • ouvindo...');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });

    inputContext = new AudioContextCtor({ latencyHint: 'interactive' });
    if (inputContext.state === 'suspended') await inputContext.resume();
    inputSource = inputContext.createMediaStreamSource(mediaStream);
    processor = inputContext.createScriptProcessor(2048, 1, 1);
    silentGain = inputContext.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = event => handleMicFrame(event.inputBuffer.getChannelData(0));
    inputSource.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(inputContext.destination);
    captureEnabled = true;
    setHint('SEXTA • ouvindo...');
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
    speechActive = false;
    audioStreamOpen = false;
    preSpeech = [];
  }

  async function buildSystemInstruction() {
    const conversationId = localStorage.getItem('sexta_conversation') || 'main';
    let sync = {};
    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}`); } catch {}
    const settings = sync.settings || {};
    const memories = (sync.memories || []).slice(0, 10).map(item => `- ${item.content}`).join('\n');
    const recent = (sync.messages || []).slice(-8).map(item => `${item.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${item.content}`).join('\n');
    const platformRule = IS_ANDROID
      ? 'Você está rodando no Android. Use android_ para ações no aparelho atual. Só use pc_ se eu disser explicitamente PC/computador/Windows.'
      : IS_DESKTOP
        ? 'Você está rodando no PC. Use pc_ para ações no computador atual. Só use android_ se eu disser explicitamente celular/Android.'
        : 'Você está no navegador; confirme o dispositivo pelo contexto do pedido quando necessário.';

    return [
      'Você é SEXTA-feira, uma assistente pessoal de voz. Fale sempre em português brasileiro natural, espontâneo e conversacional.',
      'A conversa é contínua e deve parecer uma troca de ideia, não um formulário de pergunta e resposta. Respostas comuns devem começar rápido e ser curtas por padrão.',
      'Você pode ser interrompida a qualquer momento. Se eu corrigir, complementar ou mudar de assunto enquanto você fala, pare e acompanhe imediatamente.',
      platformRule,
      'Quando eu pedir uma ação e houver ferramenta adequada, use a ferramenta. Nunca diga que concluiu antes da resposta real.',
      'Para abrir app, volume, lanterna ou mídia, não faça frase antes da ferramenta: aja primeiro. Para pesquisas mais lentas, pode dar uma confirmação curtíssima como “Certo, procurando.”.',
      'Se a ferramenta responder accepted, queued ou running, diga que está em execução; só diga “pronto” quando responder completed/done.',
      'Se eu pedir para desativar ou sair do modo de voz, não continue a resposta; o aplicativo encerrará a sessão localmente.',
      `Ajustes: humor ${settings.humor ?? 68}/100, sarcasmo ${settings.sarcasm ?? 42}/100, proatividade ${settings.proactivity ?? 55}/100, verbosidade ${settings.verbosity ?? 32}/100.`,
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
        body: JSON.stringify({ conversationId: localStorage.getItem('sexta_conversation') || 'main', deviceId: localStorage.getItem('sexta_device_id') || 'live-browser', userText: cleanUser, assistantText: cleanAssistant })
      });
    } catch (error) { console.warn('Não consegui salvar o turno Live:', error); }
  }

  function reportTurnMetrics(snapshot) {
    if (!snapshot || !sessionActive) return;
    const payload = {
      platform: ORIGIN,
      speechEndToFirstAudioMs: snapshot.firstAudioAt && snapshot.lastSpeechEndAt ? Math.max(0, Math.round(snapshot.firstAudioAt - snapshot.lastSpeechEndAt)) : null,
      speechStartToFirstAudioMs: snapshot.firstAudioAt && snapshot.turnStartedAt ? Math.max(0, Math.round(snapshot.firstAudioAt - snapshot.turnStartedAt)) : null,
      firstServerEventMs: snapshot.firstServerEventAt && snapshot.turnStartedAt ? Math.max(0, Math.round(snapshot.firstServerEventAt - snapshot.turnStartedAt)) : null,
      outputUnderruns: Math.max(0, snapshot.outputUnderruns - snapshot.turnUnderrunsAtStart),
      prebufferMs: Math.round(adaptivePrebuffer * 1000)
    };
    void api('/api/live-metrics', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
  }

  function resetTurnMetrics() {
    turnStartedAt = 0;
    firstServerEventAt = 0;
    firstAudioAt = 0;
    lastSpeechEndAt = 0;
    turnUnderrunsAtStart = outputUnderruns;
  }

  async function executeLiveTool(call) {
    const name = String(call?.name || '').trim();
    const args = call?.args && typeof call.args === 'object' ? call.args : {};
    const deviceId = localStorage.getItem('sexta_device_id') || (IS_ANDROID ? 'android-native' : 'live-browser');
    if (!name) return { ok: false, handled: true, state: 'failed', error: 'TOOL_NAME_MISSING' };

    const plugin = window.Capacitor?.Plugins?.LiveToolBridge || null;
    const localAndroid = IS_ANDROID && name.startsWith('android_') && plugin?.execute;

    if (localAndroid) {
      const planned = await api('/api/tool-execute', { method: 'POST', body: JSON.stringify({ name, args, deviceId, preferLocalAndroid: true, origin: ORIGIN }) });
      if (planned?.clientAction?.action) {
        if (planned.clientAction.action === 'open_app') await waitForOutputDrain();
        const result = await plugin.execute({ action: planned.clientAction.action, payload: planned.clientAction.payload || {} });
        return { ...result, tool: name, scope: 'android-local', state: result?.ok === false ? 'failed' : 'completed' };
      }
      return planned;
    }

    return api('/api/tool-execute', { method: 'POST', body: JSON.stringify({ name, args, deviceId, preferLocalAndroid: false, origin: ORIGIN }) });
  }

  async function handleToolCall(toolCall) {
    const calls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    if (!calls.length || !sessionActive) return;
    pendingToolCalls += calls.length;
    setHint(calls.length > 1 ? `SEXTA • executando ${calls.length} ações...` : 'SEXTA • executando...');

    const responses = await Promise.all(calls.map(async call => {
      try {
        const result = await executeLiveTool(call);
        return { id: call.id, name: call.name, response: result ?? { ok: true, state: 'completed' } };
      } catch (error) {
        return { id: call.id, name: call.name, response: { ok: false, handled: true, state: 'failed', error: String(error?.message || error || 'TOOL_FAILED').slice(0, 700) } };
      } finally { pendingToolCalls = Math.max(0, pendingToolCalls - 1); }
    }));

    if (!sessionActive) return;
    sendToolResponse(responses);
    if (pendingToolCalls === 0) setHint('SEXTA • concluindo...');
  }

  function completeCurrentTurn() {
    if (!sessionActive || stoppingByVoice || finishingTurn) return;
    finishingTurn = true;
    const snapshot = { userText: inputTranscript, assistantText: outputTranscript, turnStartedAt, firstServerEventAt, firstAudioAt, lastSpeechEndAt, outputUnderruns, turnUnderrunsAtStart };
    inputTranscript = '';
    outputTranscript = '';
    resetTurnMetrics();

    void (async () => {
      try {
        await waitForOutputDrain();
        if (!sessionActive || stoppingByVoice) return;
        if (snapshot.userText || snapshot.assistantText) void persistTurn(snapshot.userText, snapshot.assistantText);
        reportTurnMetrics(snapshot);
        assistantSpeaking = false;
        assistantInputPaused = false;
        bargeFrames = 0;
        const turnUnderruns = Math.max(0, snapshot.outputUnderruns - snapshot.turnUnderrunsAtStart);
        if (turnUnderruns === 0 && adaptivePrebuffer > OUTPUT_PREBUFFER_BASE) adaptivePrebuffer = Math.max(OUTPUT_PREBUFFER_BASE, adaptivePrebuffer - 0.012);
        if (pendingToolCalls === 0) setHint('SEXTA • ouvindo...');
      } finally { finishingTurn = false; }
    })();
  }

  function cleanupSession(closeSocket = true) {
    sessionActive = false;
    setupComplete = false;
    captureEnabled = false;
    assistantSpeaking = false;
    finishingTurn = false;
    pendingToolCalls = 0;
    speechActive = false;
    audioStreamOpen = false;
    assistantInputPaused = false;
    bargeFrames = 0;
    preSpeech = [];
    setActiveUI(false);
    if (handshakeTimeout) clearTimeout(handshakeTimeout);
    handshakeTimeout = null;
    stopMicrophone();
    stopOutput();
    if (closeSocket && websocket) { try { websocket.close(1000, 'voice mode off'); } catch {} }
    websocket = null;
    inputTranscript = '';
    outputTranscript = '';
    resetTurnMetrics();
  }

  function deactivateVoiceMode({ spoken = false } = {}) {
    if (!sessionActive) return;
    stoppingByVoice = spoken;
    if (audioStreamOpen) endAudioStream();
    const userText = inputTranscript;
    if (spoken && userText) void persistTurn(userText, '');
    cleanupSession(true);
    setHint(spoken ? 'Modo de voz desativado' : 'SEXTA Live pronta');
    stoppingByVoice = false;
  }

  async function handleServerMessage(event) {
    let raw = event.data;
    if (raw instanceof Blob) raw = await raw.text();
    if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
    let message;
    try { message = JSON.parse(raw); } catch (error) { console.warn('Mensagem Live não-JSON:', raw, error); return; }

    if (message.setupComplete) {
      setupComplete = true;
      if (handshakeTimeout) clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
      setHint('SEXTA Live conectada • abrindo microfone...');
      try { await startMicrophone(); }
      catch (error) { console.error('Microfone Live:', error); setHint(`Microfone indisponível • ${error?.name || 'erro'}`); cleanupSession(true); }
      return;
    }

    if (!firstServerEventAt && turnStartedAt) firstServerEventAt = performance.now();
    if (message.toolCall) { void handleToolCall(message.toolCall); return; }
    if (message.toolCallCancellation) { console.warn('Gemini cancelou tool calls:', message.toolCallCancellation.ids || []); return; }

    const content = message.serverContent;
    if (!content) return;

    if (content.inputTranscription?.text) {
      const incoming = content.inputTranscription.text;
      inputTranscript = mergeTranscript(inputTranscript, incoming);
      if (isVoiceOffCommand(incoming) || isVoiceOffCommand(inputTranscript)) { deactivateVoiceMode({ spoken: true }); return; }
    }
    if (content.outputTranscription?.text) outputTranscript = mergeTranscript(outputTranscript, content.outputTranscription.text);

    if (content.interrupted) {
      stopOutput();
      assistantSpeaking = false;
      assistantInputPaused = false;
      bargeFrames = 0;
      setHint('SEXTA • ouvindo...');
      return;
    }

    const parts = content.modelTurn?.parts || [];
    for (const part of parts) {
      if (!part?.inlineData?.data || !sessionActive) continue;
      if (!firstAudioAt) {
        firstAudioAt = performance.now();
        console.debug('[SEXTA Live] primeiro áudio', { fromSpeechEndMs: lastSpeechEndAt ? Math.round(firstAudioAt - lastSpeechEndAt) : null, fromSpeechStartMs: turnStartedAt ? Math.round(firstAudioAt - turnStartedAt) : null, prebufferMs: Math.round(adaptivePrebuffer * 1000) });
      }
      if (!assistantSpeaking) { assistantSpeaking = true; pauseInputForAssistant(); }
      setHint('SEXTA • falando...');
      await scheduleOutput(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
    }

    if (content.turnComplete) completeCurrentTurn();
  }

  async function activateVoiceMode() {
    if (sessionActive) return;
    if (!AudioContextCtor) { setHint('Web Audio indisponível'); return; }

    sessionActive = true;
    setupComplete = false;
    captureEnabled = false;
    assistantSpeaking = false;
    finishingTurn = false;
    stoppingByVoice = false;
    pendingToolCalls = 0;
    speechActive = false;
    audioStreamOpen = false;
    assistantInputPaused = false;
    preSpeech = [];
    bargeFrames = 0;
    adaptivePrebuffer = OUTPUT_PREBUFFER_BASE;
    nextOutputTime = 0;
    inputTranscript = '';
    outputTranscript = '';
    resetTurnMetrics();
    setActiveUI(true);
    setHint('Preparando SEXTA Live...');

    try {
      const systemInstruction = await buildSystemInstruction();
      if (!sessionActive) return;
      const session = await api('/api/live-token', { method: 'POST', body: JSON.stringify({ systemInstruction, origin: ORIGIN }) });
      if (!session?.token) throw new Error('token Live vazio');
      if (!sessionActive) return;

      setHint('Conectando SEXTA Live...');
      websocket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(session.token)}`);
      websocket.onopen = () => {
        if (!sessionActive) return;
        setHint('SEXTA Live conectada • validando sessão...');
        websocket.send(JSON.stringify({ setup: { model: `models/${session.model}`, generationConfig: { responseModalities: ['AUDIO'], thinkingConfig: { thinkingLevel: 'minimal' }, speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: session.voice } } } }, realtimeInputConfig: session.realtimeInputConfig, tools: session.tools || [], inputAudioTranscription: {}, outputAudioTranscription: {} } }));
      };
      websocket.onmessage = event => { void handleServerMessage(event); };
      websocket.onerror = event => { if (sessionActive) { console.warn('Gemini Live WebSocket error:', event); setHint('SEXTA Live • erro de conexão'); } };
      websocket.onclose = event => {
        if (!sessionActive) return;
        const code = event?.code || 0;
        const reason = String(event?.reason || '').trim();
        console.warn('Gemini Live fechado:', code, reason);
        cleanupSession(false);
        setHint(reason ? `Live fechado ${code} • ${reason.slice(0, 70)}` : `Live fechado • código ${code}`);
      };
      handshakeTimeout = setTimeout(() => { if (sessionActive && !setupComplete) { setHint('SEXTA Live • timeout no handshake'); cleanupSession(true); } }, 12000);
    } catch (error) {
      console.error('SEXTA Live:', error);
      cleanupSession(true);
      setHint(`SEXTA Live indisponível • ${String(error?.message || error).slice(0, 100)}`);
    }
  }

  function toggleVoiceMode() { if (sessionActive) deactivateVoiceMode(); else void activateVoiceMode(); }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionActive) {
      void ensureOutputContext().catch(() => {});
      if (inputContext?.state === 'suspended') void inputContext.resume().catch(() => {});
    }
  });

  voiceBtn.onclick = toggleVoiceMode;
  voiceBtn.title = 'Ativar/desativar conversa contínua com a SEXTA';
  if (wakeBtn) { wakeBtn.onclick = toggleVoiceMode; wakeBtn.title = 'Ativar/desativar conversa contínua com a SEXTA'; }
  setHint('SEXTA Live pronta');
  window.__sextaGeminiLive = {
    start: activateVoiceMode,
    stop: () => deactivateVoiceMode(),
    toggle: toggleVoiceMode,
    active: () => sessionActive,
    debug: () => ({ platform: ORIGIN, noiseFloor, adaptivePrebuffer, outputUnderruns, speechActive, assistantSpeaking, pendingToolCalls })
  };
})();
