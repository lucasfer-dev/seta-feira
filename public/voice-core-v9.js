import { StreamingSincResampler } from './audio-resampler.js';

(() => {
  const voiceBtn = document.querySelector('#voiceBtn');
  const wakeBtn = document.querySelector('#wakeBtn');
  if (!voiceBtn || !navigator.mediaDevices?.getUserMedia || !window.WebSocket) return;

  const AudioContextCtor = window.__sextaNativeAudioContext || window.AudioContext || window.webkitAudioContext;
  const INPUT_RATE = 16000;
  const OUTPUT_RATE = 24000;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const IS_DESKTOP = /Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop);
  const ORIGIN = IS_ANDROID ? 'android' : IS_DESKTOP ? 'desktop' : 'browser';
  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

  const OUTPUT_PREBUFFER = IS_ANDROID ? 0.09 : 0.045;
  const PRE_ROLL_MS = 220;
  const START_CONFIRM_MS = 70;
  const END_SILENCE_MS = 520;
  const OUTPUT_SETTLE_MS = 90;
  const OUTPUT_DRAIN_POLL_MS = 35;

  let sessionActive = false;
  let setupComplete = false;
  let state = 'off';
  let websocket = null;
  let connectingSocket = null;
  let reconnectTimer = null;
  let handshakeTimer = null;
  let reconnectAttempts = 0;
  let reconnectRequested = false;
  let cachedInstruction = '';
  let currentSession = null;
  let pendingToolCalls = 0;

  let mediaStream = null;
  let inputContext = null;
  let inputSource = null;
  let inputWorklet = null;
  let silentGain = null;
  let resampler = null;
  let captureEnabled = false;

  let noiseFloor = 0.0045;
  let speechEvidenceMs = 0;
  let lastVoicedAt = 0;
  let speechStreamOpen = false;
  let preRollFrames = [];
  let maxPreRollFrames = 6;

  let outputContext = null;
  let nextOutputTime = 0;
  const outputSources = new Set();
  let assistantSpeaking = false;
  let serverTurnComplete = false;
  let settlementGeneration = 0;

  let turn = freshTurn();

  function freshTurn() {
    return {
      interimInput: '',
      finalInput: '',
      outputText: '',
      speechStartAt: 0,
      streamEndAt: 0,
      firstInterimAt: 0,
      firstFinalAt: 0,
      firstModelAt: 0,
      firstAudioAt: 0
    };
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function transition(next, extra = {}) {
    if (!next) return;
    state = next;
    emit('sexta:voice-state', {
      state,
      sessionActive,
      setupComplete,
      assistantSpeaking,
      pendingToolCalls,
      speechStreamOpen,
      ...extra
    });
  }

  function emitTranscript() {
    emit('sexta:voice-transcript', { interim: turn.interimInput, final: turn.finalInput });
  }

  function authHeaders(extra = {}) {
    const token = localStorage.getItem('sexta_token') || '';
    return { 'Content-Type':'application/json', ...extra, ...(token ? { Authorization:`Bearer ${token}` } : {}) };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers:authHeaders(options.headers || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Erro ${response.status}`);
    return data;
  }

  function reportMetric(kind, extra = {}) {
    void api('/api/live-metrics', {
      method:'POST',
      body:JSON.stringify({ kind:`voice_core_v9:${kind}`, platform:ORIGIN, state, ...extra })
    }).catch(() => {});
  }

  function normalizeSpeech(text = '') {
    return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .toLowerCase().replace(/[.,!?;:]+/g,' ').replace(/\s+/g,' ').trim();
  }

  function mergeTranscript(current, incoming) {
    const next = String(incoming || '').replace(/\s+/g,' ').trim();
    if (!next) return current;
    if (!current || next.startsWith(current)) return next;
    if (current === next || current.endsWith(next)) return current;
    const a = normalizeSpeech(current);
    const b = normalizeSpeech(next);
    if (a === b || a.endsWith(b)) return current;
    if (b.startsWith(a)) return next;
    return `${current} ${next}`.replace(/\s+/g,' ').trim();
  }

  function isVoiceOffCommand(text = '') {
    const value = normalizeSpeech(text).replace(/^sexta(?: feira)?\s+/, '');
    return /^(?:desativar|desative|desliga|desligue|desligar|encerrar|encerre|fechar|fecha|pare|parar)\s+(?:o\s+)?modo\s+de\s+voz$/.test(value)
      || /^(?:sair|saia)\s+do\s+modo\s+de\s+voz$/.test(value)
      || /^(?:desativar|desative|desliga|desligue|desligar)\s+(?:a\s+)?voz$/.test(value);
  }

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function speechThreshold() {
    const base = IS_ANDROID ? 0.012 : 0.0065;
    const echoGuard = assistantSpeaking ? 0.018 : 0;
    return Math.max(base, echoGuard, noiseFloor * (assistantSpeaking ? 4.0 : 2.7));
  }

  function sendRealtime(payload) {
    if (websocket?.readyState === WebSocket.OPEN && setupComplete && sessionActive) {
      websocket.send(JSON.stringify({ realtimeInput:payload }));
      return true;
    }
    return false;
  }

  function floatToPcm16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i += 1) {
      const v = Math.max(-1, Math.min(1, float32[i]));
      out[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
    }
    return new Uint8Array(out.buffer);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function pcm16ToFloat32(bytes) {
    const count = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const sample = view.getInt16(i * 2, true);
      out[i] = sample < 0 ? sample / 32768 : sample / 32767;
    }
    return out;
  }

  function sendAudioFrame(frame) {
    const bytes = floatToPcm16(frame);
    if (!bytes.length) return;
    sendRealtime({ audio:{ data:bytesToBase64(bytes), mimeType:`audio/pcm;rate=${INPUT_RATE}` } });
  }

  function pushPreRoll(frame) {
    preRollFrames.push(frame.slice());
    while (preRollFrames.length > maxPreRollFrames) preRollFrames.shift();
  }

  function stopOutput(resetTurnComplete = true) {
    settlementGeneration += 1;
    for (const source of outputSources) {
      try { source.stop(); } catch {}
    }
    outputSources.clear();
    nextOutputTime = 0;
    assistantSpeaking = false;
    if (resetTurnComplete) serverTurnComplete = false;
  }

  function beginSpeech(now) {
    if (speechStreamOpen || !sessionActive || !setupComplete) return;
    if (assistantSpeaking) stopOutput(false);

    serverTurnComplete = false;
    settlementGeneration += 1;
    turn = freshTurn();
    turn.speechStartAt = now;
    emitTranscript();

    speechStreamOpen = true;
    transition('user_speaking');
    reportMetric('speech_start');

    for (const frame of preRollFrames) sendAudioFrame(frame);
    preRollFrames = [];
  }

  function endSpeech(now) {
    if (!speechStreamOpen) return;
    // Official Hybrid VAD flush: this ends the current audio stream/turn, not the Live session.
    sendRealtime({ audioStreamEnd:true });
    speechStreamOpen = false;
    speechEvidenceMs = 0;
    lastVoicedAt = 0;
    turn.streamEndAt = now;
    preRollFrames = [];
    transition('thinking');
    reportMetric('stream_end');
  }

  function processMicFrame(raw) {
    if (!captureEnabled || !sessionActive || !setupComplete || !resampler) return;
    const frame = resampler.process(raw);
    if (!frame.length) return;

    const now = performance.now();
    const frameMs = frame.length / INPUT_RATE * 1000;
    const level = rms(frame);

    if (!speechStreamOpen && !assistantSpeaking && level < 0.018) {
      noiseFloor = noiseFloor * 0.994 + level * 0.006;
    }

    const voiced = level >= speechThreshold();

    if (!speechStreamOpen) {
      pushPreRoll(frame);
      if (voiced) {
        speechEvidenceMs += frameMs;
        lastVoicedAt = now;
        if (speechEvidenceMs >= START_CONFIRM_MS) beginSpeech(now - speechEvidenceMs);
      } else {
        speechEvidenceMs = Math.max(0, speechEvidenceMs - frameMs * 0.6);
      }
      return;
    }

    sendAudioFrame(frame);
    if (voiced) lastVoicedAt = now;
    if (lastVoicedAt && now - lastVoicedAt >= END_SILENCE_MS) endSpeech(now);
  }

  async function ensureOutputContext() {
    if (!AudioContextCtor) throw new Error('Web Audio indisponível');
    if (!outputContext || outputContext.state === 'closed') {
      outputContext = new AudioContextCtor({ latencyHint:'interactive', sampleRate:OUTPUT_RATE });
    }
    if (outputContext.state === 'suspended' && !document.hidden) await outputContext.resume();
    return outputContext;
  }

  function playbackDrained() {
    if (!outputContext) return outputSources.size === 0;
    return outputSources.size === 0 && nextOutputTime <= outputContext.currentTime + 0.025;
  }

  async function scheduleOutput(base64, mimeType = '') {
    const bytes = base64ToBytes(base64);
    if (!bytes.length || !sessionActive) return;
    const sampleRate = Number(String(mimeType).match(/rate=(\d+)/i)?.[1] || OUTPUT_RATE);
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
    if (nextOutputTime < now + 0.008) nextOutputTime = now + OUTPUT_PREBUFFER;
    source.start(nextOutputTime);
    nextOutputTime += floats.length / sampleRate;
  }

  async function settleCompletedTurn() {
    const generation = ++settlementGeneration;
    const startedAt = performance.now();
    while (sessionActive && generation === settlementGeneration && performance.now() - startedAt < 30000) {
      if (!speechStreamOpen && serverTurnComplete && pendingToolCalls === 0 && playbackDrained()) {
        await new Promise(resolve => setTimeout(resolve, OUTPUT_SETTLE_MS));
        if (!sessionActive || generation !== settlementGeneration) return;
        assistantSpeaking = false;
        const snapshot = { ...turn };
        serverTurnComplete = false;
        turn = freshTurn();
        emitTranscript();
        if (snapshot.finalInput || snapshot.outputText) void persistTurn(snapshot.finalInput, snapshot.outputText);
        reportMetric('turn', {
          speechStartToInterimMs:snapshot.firstInterimAt && snapshot.speechStartAt ? Math.round(snapshot.firstInterimAt - snapshot.speechStartAt) : null,
          speechStartToFinalMs:snapshot.firstFinalAt && snapshot.speechStartAt ? Math.round(snapshot.firstFinalAt - snapshot.speechStartAt) : null,
          speechStartToSpeakingMs:snapshot.firstAudioAt && snapshot.speechStartAt ? Math.round(snapshot.firstAudioAt - snapshot.speechStartAt) : null,
          endToFirstAudioMs:snapshot.firstAudioAt && snapshot.streamEndAt ? Math.round(snapshot.firstAudioAt - snapshot.streamEndAt) : null
        });
        transition('listening');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, OUTPUT_DRAIN_POLL_MS));
    }
  }

  async function startMicrophone() {
    if (mediaStream && inputContext && inputWorklet) {
      captureEnabled = true;
      if (inputContext.state === 'suspended') await inputContext.resume();
      transition('listening');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio:{ channelCount:{ideal:1}, echoCancellation:true, noiseSuppression:true, autoGainControl:true, latency:{ideal:0.01} }
    });
    const track = mediaStream.getAudioTracks?.()[0];
    const settings = track?.getSettings?.() || {};

    inputContext = new AudioContextCtor({ latencyHint:'interactive' });
    if (inputContext.state === 'suspended') await inputContext.resume();
    resampler = new StreamingSincResampler(inputContext.sampleRate, INPUT_RATE, { radius:16, cutoffScale:0.92 });
    await inputContext.audioWorklet.addModule('/live-input-worklet.js');

    inputSource = inputContext.createMediaStreamSource(mediaStream);
    inputWorklet = new AudioWorkletNode(inputContext, 'sexta-mic-processor', {
      numberOfInputs:1,
      numberOfOutputs:1,
      outputChannelCount:[1]
    });
    silentGain = inputContext.createGain();
    silentGain.gain.value = 0;
    inputWorklet.port.onmessage = event => {
      const raw = event.data instanceof Float32Array ? event.data : new Float32Array(event.data || []);
      processMicFrame(raw);
    };
    inputSource.connect(inputWorklet);
    inputWorklet.connect(silentGain);
    silentGain.connect(inputContext.destination);

    maxPreRollFrames = Math.max(3, Math.ceil(PRE_ROLL_MS / 40));
    captureEnabled = true;
    reportMetric('capture_ready', {
      trackSampleRate:Number(settings.sampleRate || 0) || null,
      trackChannelCount:Number(settings.channelCount || 0) || null,
      echoCancellation:settings.echoCancellation === true,
      noiseSuppression:settings.noiseSuppression === true,
      autoGainControl:settings.autoGainControl === true,
      audioSource:`hybrid-vad:${inputContext.sampleRate}->${INPUT_RATE}`
    });
    emit('sexta:mic-settings', {
      settings:{ ...settings, audioContextSampleRate:inputContext.sampleRate },
      capabilities:track?.getCapabilities?.() || {},
      capturedAt:Date.now()
    });
    transition('listening');
  }

  function stopMicrophone() {
    captureEnabled = false;
    try { if (speechStreamOpen) sendRealtime({ audioStreamEnd:true }); } catch {}
    speechStreamOpen = false;
    try { if (inputWorklet?.port) inputWorklet.port.onmessage = null; } catch {}
    try { inputWorklet?.disconnect(); } catch {}
    try { inputSource?.disconnect(); } catch {}
    try { silentGain?.disconnect(); } catch {}
    for (const track of mediaStream?.getTracks?.() || []) track.stop();
    try { inputContext?.close(); } catch {}
    mediaStream = inputContext = inputSource = inputWorklet = silentGain = resampler = null;
    speechEvidenceMs = 0;
    lastVoicedAt = 0;
    preRollFrames = [];
  }

  async function buildSystemInstruction() {
    const conversationId = localStorage.getItem('sexta_conversation') || 'main';
    let sync = {};
    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}&fresh=1`); } catch {}
    emit('sexta:session-context', { loadedAt:Date.now(), messages:sync.messages?.length || 0, memories:sync.memories?.length || 0 });
    const settings = sync.settings || {};
    const memories = (sync.memories || []).slice(0, 10).map(item => `- ${item.content}`).join('\n');
    const recent = (sync.messages || []).slice(-12).map(item => `${item.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${item.content}`).join('\n');
    const platformRule = IS_ANDROID
      ? 'DISPOSITIVO ATUAL: Android. Use android_ para ações no aparelho; Codex pode ser delegado por pc_codex_task.'
      : IS_DESKTOP
        ? 'DISPOSITIVO ATUAL: PC. Use pc_ para ações no computador.'
        : 'DISPOSITIVO ATUAL: navegador. Escolha o dispositivo pela capacidade e pelo pedido.';

    return [
      'Você é SEXTA-feira, assistente pessoal de voz. Converse em português brasileiro natural, curta e diretamente.',
      'A sessão é contínua. Depois de iniciada, o usuário não precisa repetir “Sexta-feira”.',
      'Responda assim que um turno terminar e a intenção estiver clara.',
      'Se o usuário falar por cima de você, ceda a vez imediatamente.',
      'Não narre estados internos. Ferramentas rápidas podem acontecer silenciosamente.',
      'Nunca diga que uma ação terminou antes da ferramenta confirmar.',
      platformRule,
      `Ajustes: humor ${settings.humor ?? 68}/100, sarcasmo ${settings.sarcasm ?? 42}/100, proatividade ${settings.proactivity ?? 55}/100, verbosidade ${settings.verbosity ?? 32}/100.`,
      memories ? `Memórias relevantes:\n${memories}` : '',
      recent ? `Contexto recente:\n${recent}` : ''
    ].filter(Boolean).join('\n\n');
  }

  async function persistTurn(userText, assistantText) {
    const user = String(userText || '').replace(/\s+/g, ' ').trim();
    const assistant = String(assistantText || '').replace(/\s+/g, ' ').trim();
    if (!user && !assistant) return;
    try {
      await api('/api/live-turn', {
        method:'POST',
        body:JSON.stringify({
          conversationId:localStorage.getItem('sexta_conversation') || 'main',
          deviceId:localStorage.getItem('sexta_device_id') || 'voice-v9',
          userText:user,
          assistantText:assistant
        })
      });
    } catch {}
  }

  async function executeLiveTool(call) {
    const name = String(call?.name || '').trim();
    const args = call?.args && typeof call.args === 'object' ? call.args : {};
    const deviceId = localStorage.getItem('sexta_device_id') || (IS_ANDROID ? 'android-native' : 'voice-v9');
    if (!name) return { ok:false, handled:true, state:'failed', error:'TOOL_NAME_MISSING' };

    const plugin = window.Capacitor?.Plugins?.LiveToolBridge || null;
    if (IS_ANDROID && name.startsWith('android_') && plugin?.execute) {
      const planned = await api('/api/tool-execute', {
        method:'POST',
        body:JSON.stringify({ name, args, deviceId, preferLocalAndroid:true, origin:ORIGIN })
      });
      if (planned?.clientAction?.action) {
        const result = await plugin.execute({ action:planned.clientAction.action, payload:planned.clientAction.payload || {} });
        return { ...result, tool:name, scope:'android-local', state:result?.ok === false ? 'failed' : 'completed' };
      }
      return planned;
    }

    return api('/api/tool-execute', {
      method:'POST',
      body:JSON.stringify({ name, args, deviceId, preferLocalAndroid:false, origin:ORIGIN })
    });
  }

  function sendToolResponses(responses) {
    if (!responses?.length || websocket?.readyState !== WebSocket.OPEN || !setupComplete || !sessionActive) return;
    websocket.send(JSON.stringify({ toolResponse:{ functionResponses:responses } }));
  }

  async function handleToolCall(toolCall) {
    const calls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    if (!calls.length || !sessionActive) return;
    pendingToolCalls += calls.length;
    transition('tool');

    const responses = await Promise.all(calls.map(async call => {
      try {
        const result = await executeLiveTool(call);
        return { id:call.id, name:call.name, response:result ?? { ok:true, state:'completed' } };
      } catch (error) {
        return {
          id:call.id,
          name:call.name,
          response:{ ok:false, handled:true, state:'failed', error:String(error?.message || error || 'TOOL_FAILED').slice(0,700) }
        };
      } finally {
        pendingToolCalls = Math.max(0, pendingToolCalls - 1);
      }
    }));

    sendToolResponses(responses);
    if (!speechStreamOpen && serverTurnComplete && pendingToolCalls === 0) void settleCompletedTurn();
  }

  function markModelActivity() {
    const now = performance.now();
    if (!turn.firstModelAt) turn.firstModelAt = now;
  }

  async function handleServerMessage(event, socket) {
    if (socket !== websocket && socket !== connectingSocket) return;
    let raw = event.data;
    if (raw instanceof Blob) raw = await raw.text();
    if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
    let message;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.setupComplete) {
      setupComplete = true;
      reconnectAttempts = 0;
      reconnectRequested = false;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      handshakeTimer = null;
      try { await startMicrophone(); }
      catch (error) {
        console.error('[SEXTA v9] microfone:', error);
        transition('error', { label:'Não consegui abrir o microfone.' });
      }
      return;
    }

    // V9 deliberately ignores resumption handles until the basic conversation loop is stable.
    if (message.sessionResumptionUpdate) return;

    if (message.goAway) {
      reconnectRequested = true;
      try { socket.close(1000, 'goaway'); } catch {}
      return;
    }

    if (message.toolCall) {
      markModelActivity();
      void handleToolCall(message.toolCall);
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) {
      const text = String(content.interimInputTranscription.text || '').trim();
      if (text) {
        if (!turn.firstInterimAt) turn.firstInterimAt = performance.now();
        turn.interimInput = text;
        emitTranscript();
      }
    }

    if (content.inputTranscription?.text) {
      const text = String(content.inputTranscription.text || '').trim();
      if (text) {
        if (!turn.firstFinalAt) turn.firstFinalAt = performance.now();
        turn.finalInput = mergeTranscript(turn.finalInput, text);
        turn.interimInput = '';
        emitTranscript();
        if (isVoiceOffCommand(turn.finalInput)) {
          stopVoice();
          return;
        }
      }
    }

    if (content.waitingForInput) {
      assistantSpeaking = false;
      if (!speechStreamOpen && pendingToolCalls === 0) transition('listening');
    }

    if (content.interrupted) {
      stopOutput(false);
      transition(speechStreamOpen ? 'user_speaking' : 'listening');
    }

    if (content.outputTranscription?.text) {
      markModelActivity();
      turn.outputText = mergeTranscript(turn.outputText, content.outputTranscription.text);
    }

    // Gemini 3.1 may bundle several content parts in one server event; process every part.
    for (const part of content.modelTurn?.parts || []) {
      if (!part?.inlineData?.data || !sessionActive) continue;
      markModelActivity();
      if (!turn.firstAudioAt) turn.firstAudioAt = performance.now();
      assistantSpeaking = true;
      transition('speaking');
      await scheduleOutput(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
    }

    if (content.turnComplete && !speechStreamOpen) {
      serverTurnComplete = true;
      void settleCompletedTurn();
    }
  }

  function scheduleReconnect(reason = 'reconnect') {
    if (!sessionActive || reconnectTimer) return;
    setupComplete = false;
    transition('recovering');
    const delay = reconnectRequested ? 150 : Math.min(4000, 400 * (2 ** Math.min(reconnectAttempts, 4)));
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      cachedInstruction = '';
      void connectLive(reason);
    }, delay);
  }

  async function connectLive(reason = 'initial') {
    if (!sessionActive || connectingSocket || (websocket?.readyState === WebSocket.OPEN && setupComplete)) return;
    transition(reason === 'initial' ? 'connecting' : 'recovering');

    try {
      if (!cachedInstruction) cachedInstruction = await buildSystemInstruction();
      if (!sessionActive) return;

      const session = await api('/api/live-token', {
        method:'POST',
        body:JSON.stringify({
          systemInstruction:cachedInstruction,
          origin:ORIGIN,
          resumptionHandle:'',
          clientVersion:'v9',
          liveGeneration:'3.1',
          vadMode:'hybrid'
        })
      });
      if (!session?.token) throw new Error('token Live vazio');
      if (session.liveGeneration !== '3.1') throw new Error('Gemini 3.1 Live não foi ativado');
      currentSession = session;

      const socket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(session.token)}`);
      connectingSocket = socket;

      socket.onopen = () => {
        if (!sessionActive) {
          try { socket.close(1000, 'off'); } catch {}
          return;
        }
        websocket = socket;
        connectingSocket = null;
        socket.send(JSON.stringify({
          setup:{
            model:`models/${session.model}`,
            generationConfig:{
              responseModalities:['AUDIO'],
              thinkingConfig:session.thinkingConfig || { thinkingLevel:'minimal' },
              speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName:session.voice } } }
            },
            realtimeInputConfig:session.realtimeInputConfig,
            tools:session.tools || [],
            inputAudioTranscription:session.inputAudioTranscription || {},
            outputAudioTranscription:session.outputAudioTranscription || {},
            contextWindowCompression:session.contextWindowCompression || { slidingWindow:{} },
            sessionResumption:{}
          }
        }));

        if (handshakeTimer) clearTimeout(handshakeTimer);
        handshakeTimer = setTimeout(() => {
          if (sessionActive && socket === websocket && !setupComplete) {
            try { socket.close(4000, 'handshake-timeout'); } catch {}
          }
        }, 10000);
      };

      socket.onmessage = event => { void handleServerMessage(event, socket); };
      socket.onerror = event => console.warn('[SEXTA v9] websocket:', event);
      socket.onclose = event => {
        if (connectingSocket === socket) connectingSocket = null;
        if (websocket === socket) websocket = null;
        setupComplete = false;
        if (handshakeTimer) clearTimeout(handshakeTimer);
        handshakeTimer = null;
        stopOutput();
        speechStreamOpen = false;
        speechEvidenceMs = 0;
        lastVoicedAt = 0;
        preRollFrames = [];
        if (!sessionActive) return;
        scheduleReconnect(reconnectRequested ? 'goaway' : 'socket-close');
      };
    } catch (error) {
      connectingSocket = null;
      console.error('[SEXTA v9] conexão:', error);
      if (sessionActive) scheduleReconnect('connect-error');
    }
  }

  function cleanup(closeSocket = true) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (handshakeTimer) clearTimeout(handshakeTimer);
    reconnectTimer = handshakeTimer = null;
    setupComplete = false;
    pendingToolCalls = 0;
    reconnectAttempts = 0;
    reconnectRequested = false;
    cachedInstruction = '';
    currentSession = null;
    settlementGeneration += 1;
    stopMicrophone();
    stopOutput();
    if (closeSocket) {
      try { connectingSocket?.close(1000, 'voice-off'); } catch {}
      try { websocket?.close(1000, 'voice-off'); } catch {}
    }
    connectingSocket = websocket = null;
    turn = freshTurn();
    emitTranscript();
  }

  async function startVoice() {
    if (sessionActive) return;
    if (!AudioContextCtor || !window.AudioWorkletNode) {
      transition('error', { label:'Este navegador não suporta áudio em tempo real.' });
      return;
    }
    sessionActive = true;
    turn = freshTurn();
    transition('connecting');
    await connectLive('initial');
  }

  function stopVoice() {
    if (!sessionActive) return;
    sessionActive = false;
    cleanup(true);
    transition('off');
  }

  function toggleVoice() {
    if (sessionActive) stopVoice();
    else void startVoice();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionActive) {
      if (inputContext?.state === 'suspended') void inputContext.resume().catch(() => {});
      if (outputContext?.state === 'suspended') void outputContext.resume().catch(() => {});
    }
  });

  voiceBtn.onclick = toggleVoice;
  if (wakeBtn) wakeBtn.onclick = toggleVoice;
  transition('off');

  window.__sextaGeminiLive = {
    start:startVoice,
    stop:stopVoice,
    toggle:toggleVoice,
    active:() => sessionActive,
    debug:() => ({
      version:'voice-core-v9',
      model:currentSession?.model || null,
      liveGeneration:currentSession?.liveGeneration || null,
      platform:ORIGIN,
      vadMode:'hybrid',
      state,
      sessionActive,
      setupComplete,
      captureEnabled,
      speechStreamOpen,
      assistantSpeaking,
      pendingToolCalls,
      interimTranscript:turn.interimInput,
      finalTranscript:turn.finalInput,
      outputTranscript:turn.outputText,
      noiseFloor,
      threshold:speechThreshold(),
      inputSampleRate:inputContext?.sampleRate || null
    })
  };
})();
