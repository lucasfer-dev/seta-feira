(() => {
  const voiceBtn = document.querySelector('#voiceBtn');
  const wakeBtn = document.querySelector('#wakeBtn');
  if (!voiceBtn || !navigator.mediaDevices?.getUserMedia || !window.WebSocket) return;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const INPUT_RATE = 16000;
  const OUTPUT_RATE = 24000;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const IS_DESKTOP = /Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop);
  const ORIGIN = IS_ANDROID ? 'android' : IS_DESKTOP ? 'desktop' : 'browser';
  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const OUTPUT_PREBUFFER = IS_ANDROID ? 0.09 : 0.045;
  const TURN_SETTLE_MS = 650;
  const RESCUE_DELAY_MS = 4200;
  const FAST_RESCUE_DELAY_MS = 2400;
  const HARD_RECOVERY_MS = 9000;

  const QUICK_SILENT_TOOLS = new Set([
    'android_open_app','android_open_settings','android_set_volume','android_adjust_volume',
    'android_flashlight','android_media','pc_open_app','pc_open_project','pc_open_url'
  ]);

  let sessionActive = false;
  let setupComplete = false;
  let state = 'off';
  let websocket = null;
  let connectingSocket = null;
  let reconnectTimer = null;
  let handshakeTimer = null;
  let reconnectAttempts = 0;
  let reconnectRequested = false;
  let resumptionHandle = '';
  let cachedInstruction = '';
  let currentSession = null;
  let pendingToolCalls = 0;

  let mediaStream = null;
  let inputContext = null;
  let inputSource = null;
  let inputWorklet = null;
  let silentGain = null;
  let captureEnabled = false;
  let noiseFloor = 0.006;
  let localVoiceActive = false;
  let localLastVoiceAt = 0;
  let localVoiceStartedAt = 0;
  let localVoiceEndedAt = 0;

  let outputContext = null;
  let nextOutputTime = 0;
  let lastOutputChunkAt = 0;
  const outputSources = new Set();
  let assistantSpeaking = false;

  let turn = freshTurn();
  let finalizeTimer = null;
  let lastModelActivityAt = 0;
  let lastServerAt = 0;
  let rescueText = '';
  let rescueSent = false;
  let waitingForInput = false;
  let hardRecoveryStarted = false;

  function freshTurn() {
    return {
      interimInput: '',
      finalInput: '',
      outputText: '',
      startedAt: performance.now(),
      firstInputAt: 0,
      firstModelAt: 0,
      firstAudioAt: 0,
      turnCompleteAt: 0
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
      ...extra
    });
  }

  function emitTranscript() {
    emit('sexta:voice-transcript', {
      interim: turn.interimInput,
      final: turn.finalInput
    });
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

  function normalizeSpeech(text = '') {
    return String(text)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function mergeTranscript(current, incoming) {
    const next = String(incoming || '').replace(/\s+/g, ' ').trim();
    if (!next) return current;
    if (!current) return next;
    if (next === current || current.endsWith(next)) return current;
    if (next.startsWith(current)) return next;
    const a = normalizeSpeech(current);
    const b = normalizeSpeech(next);
    if (a === b || a.endsWith(b)) return current;
    if (b.startsWith(a)) return next;
    return `${current} ${next}`.replace(/\s+/g, ' ').trim();
  }

  function isVoiceOffCommand(text) {
    const value = normalizeSpeech(text).replace(/^sexta(?: feira)?\s+/, '');
    return /^(?:desativar|desative|desliga|desligue|desligar|encerrar|encerre|fechar|fecha|pare|parar)\s+(?:o\s+)?modo\s+de\s+voz$/.test(value)
      || /^(?:sair|saia)\s+do\s+modo\s+de\s+voz$/.test(value)
      || /^(?:desativar|desative|desliga|desligue|desligar)\s+(?:a\s+)?voz$/.test(value);
  }

  function looksLikeCompleteRequest(text = '') {
    const value = normalizeSpeech(text);
    if (!value) return false;
    if (/[?!.]\s*$/.test(String(text).trim())) return true;
    return /^(?:sexta(?: feira)?\s+)?(?:como|qual|quais|quem|onde|quando|por que|porque|o que|ta ai|t[aá] ai|abre|abra|fecha|feche|faz|fa[cç]a|me fala|me diga|me diz|mostra|procura|pesquisa|manda|envia|liga|desliga|aumenta|abaixa|analisa|corrige)\b/.test(value);
  }

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function activityThreshold() {
    return Math.max(IS_ANDROID ? 0.013 : 0.009, noiseFloor * 3.1);
  }

  function updateLocalActivity(samples) {
    const level = rms(samples);
    const now = performance.now();
    if (!assistantSpeaking && level < (IS_ANDROID ? 0.026 : 0.019)) {
      noiseFloor = noiseFloor * 0.988 + level * 0.012;
    }
    const active = level >= activityThreshold();
    if (active) {
      localLastVoiceAt = now;
      if (!localVoiceActive) {
        localVoiceActive = true;
        localVoiceStartedAt = now;
        localVoiceEndedAt = 0;
        if (!assistantSpeaking) transition('user_speaking');
      }
      return;
    }
    if (localVoiceActive && now - localLastVoiceAt >= 560) {
      localVoiceActive = false;
      localVoiceEndedAt = localLastVoiceAt;
      if (!assistantSpeaking && pendingToolCalls === 0) {
        transition(turn.finalInput || turn.interimInput ? 'thinking' : 'listening');
      }
    }
  }

  function floatToPcm16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i += 1) {
      const value = Math.max(-1, Math.min(1, float32[i]));
      out[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
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
    const samples = Math.floor(bytes.byteLength / 2);
    const view = new DataView(bytes.buffer, bytes.byteOffset, samples * 2);
    const floats = new Float32Array(samples);
    for (let i = 0; i < samples; i += 1) {
      const sample = view.getInt16(i * 2, true);
      floats[i] = sample < 0 ? sample / 32768 : sample / 32767;
    }
    return floats;
  }

  function sendRealtime(payload) {
    if (websocket?.readyState === WebSocket.OPEN && setupComplete && sessionActive) {
      websocket.send(JSON.stringify({ realtimeInput: payload }));
      return true;
    }
    return false;
  }

  function sendPcmFrame(raw) {
    if (!captureEnabled || !sessionActive || !setupComplete || !inputContext) return;
    updateLocalActivity(raw);
    const resampled = resampleLinear(raw, inputContext.sampleRate, INPUT_RATE);
    const pcm = floatToPcm16(resampled);
    if (!pcm.length) return;
    sendRealtime({ audio: { data: bytesToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_RATE}` } });
  }

  async function ensureOutputContext() {
    if (!AudioContextCtor) throw new Error('Web Audio indisponível');
    if (!outputContext || outputContext.state === 'closed') {
      outputContext = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: OUTPUT_RATE });
    }
    if (outputContext.state === 'suspended' && !document.hidden) await outputContext.resume();
    return outputContext;
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
    if (nextOutputTime < now + 0.008) nextOutputTime = now + OUTPUT_PREBUFFER;
    source.start(nextOutputTime);
    nextOutputTime += floats.length / sampleRate;
    lastOutputChunkAt = performance.now();
  }

  async function startMicrophone() {
    if (mediaStream && inputContext && inputWorklet) {
      captureEnabled = true;
      if (inputContext.state === 'suspended') await inputContext.resume();
      transition('listening');
      return;
    }
    if (!AudioContextCtor || !window.AudioWorkletNode) throw new Error('AudioWorklet indisponível');
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    inputContext = new AudioContextCtor({ latencyHint: 'interactive' });
    if (inputContext.state === 'suspended') await inputContext.resume();
    await inputContext.audioWorklet.addModule('/live-input-worklet.js');
    inputSource = inputContext.createMediaStreamSource(mediaStream);
    inputWorklet = new AudioWorkletNode(inputContext, 'sexta-mic-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
    });
    silentGain = inputContext.createGain();
    silentGain.gain.value = 0;
    inputWorklet.port.onmessage = event => {
      const frame = event.data instanceof Float32Array ? event.data : new Float32Array(event.data || []);
      sendPcmFrame(frame);
    };
    inputSource.connect(inputWorklet);
    inputWorklet.connect(silentGain);
    silentGain.connect(inputContext.destination);
    captureEnabled = true;
    transition('listening');
  }

  function stopMicrophone() {
    captureEnabled = false;
    try { if (inputWorklet?.port) inputWorklet.port.onmessage = null; } catch {}
    try { inputWorklet?.disconnect(); } catch {}
    try { inputSource?.disconnect(); } catch {}
    try { silentGain?.disconnect(); } catch {}
    for (const track of mediaStream?.getTracks?.() || []) track.stop();
    try { inputContext?.close(); } catch {}
    mediaStream = null; inputContext = null; inputSource = null; inputWorklet = null; silentGain = null;
    localVoiceActive = false;
  }

  async function buildSystemInstruction() {
    const conversationId = localStorage.getItem('sexta_conversation') || 'main';
    let sync = {};
    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}&fresh=1`); } catch {}
    emit('sexta:session-context', { loadedAt: Date.now(), messages: sync.messages?.length || 0, memories: sync.memories?.length || 0 });
    const settings = sync.settings || {};
    const memories = (sync.memories || []).slice(0, 10).map(item => `- ${item.content}`).join('\n');
    const recent = (sync.messages || []).slice(-12).map(item => `${item.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${item.content}`).join('\n');
    const platformRule = IS_ANDROID
      ? 'DISPOSITIVO ATUAL: Android. Para ações no aparelho atual use android_. Para Codex/programação você pode delegar ao PC por pc_codex_task.'
      : IS_DESKTOP
        ? 'DISPOSITIVO ATUAL: PC. Para ações no computador atual use pc_. Use android_ apenas se o usuário pedir o celular.'
        : 'DISPOSITIVO ATUAL: navegador. Escolha o dispositivo pela capacidade e pelo pedido.';
    return [
      'Você é SEXTA-feira, assistente pessoal de voz. Converse em português brasileiro natural, curta e diretamente.',
      'A sessão é contínua: depois de iniciada, o usuário NÃO precisa repetir “Sexta-feira”.',
      'Quando o usuário fizer uma pergunta completa ou chamar você diretamente, responda. Não fique aguardando mais fala se a intenção já estiver clara.',
      'Respeite hesitações reais, mas não transforme silêncio normal em espera indefinida.',
      'Se o usuário falar por cima de você, ceda a vez imediatamente e siga a nova fala.',
      'Não narre estados internos. Ferramentas rápidas podem executar silenciosamente. Tarefas longas podem seguir em segundo plano.',
      'Nunca diga que uma ação terminou antes da ferramenta confirmar.',
      platformRule,
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
        body: JSON.stringify({
          conversationId: localStorage.getItem('sexta_conversation') || 'main',
          deviceId: localStorage.getItem('sexta_device_id') || 'voice-v5',
          userText: cleanUser,
          assistantText: cleanAssistant
        })
      });
    } catch (error) { console.warn('[SEXTA v5] persistência:', error); }
  }

  function reportMetric(kind, extra = {}) {
    const payload = { kind: `voice_core_v5:${kind}`, platform: ORIGIN, state, ...extra };
    void api('/api/live-metrics', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
  }

  async function executeLiveTool(call) {
    const name = String(call?.name || '').trim();
    const args = call?.args && typeof call.args === 'object' ? call.args : {};
    const deviceId = localStorage.getItem('sexta_device_id') || (IS_ANDROID ? 'android-native' : 'voice-v5');
    if (!name) return { ok:false, handled:true, state:'failed', error:'TOOL_NAME_MISSING' };
    const plugin = window.Capacitor?.Plugins?.LiveToolBridge || null;
    if (IS_ANDROID && name.startsWith('android_') && plugin?.execute) {
      const planned = await api('/api/tool-execute', { method:'POST', body:JSON.stringify({ name,args,deviceId,preferLocalAndroid:true,origin:ORIGIN }) });
      if (planned?.clientAction?.action) {
        const result = await plugin.execute({ action:planned.clientAction.action, payload:planned.clientAction.payload || {} });
        return { ...result, tool:name, scope:'android-local', state:result?.ok === false ? 'failed' : 'completed' };
      }
      return planned;
    }
    return api('/api/tool-execute', { method:'POST', body:JSON.stringify({ name,args,deviceId,preferLocalAndroid:false,origin:ORIGIN }) });
  }

  function sendToolResponses(responses) {
    if (!responses?.length || websocket?.readyState !== WebSocket.OPEN || !setupComplete || !sessionActive) return;
    websocket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  }

  async function handleToolCall(toolCall) {
    const calls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    if (!calls.length || !sessionActive) return;
    pendingToolCalls += calls.length;
    lastModelActivityAt = performance.now();
    transition('tool');
    const responses = await Promise.all(calls.map(async call => {
      try {
        const result = await executeLiveTool(call);
        return {
          id: call.id, name: call.name, response: result ?? { ok:true, state:'completed' },
          ...(currentSession?.supportsNonBlocking ? { scheduling: QUICK_SILENT_TOOLS.has(call.name) ? 'SILENT' : 'WHEN_IDLE' } : {})
        };
      } catch (error) {
        return {
          id: call.id, name: call.name,
          response: { ok:false, handled:true, state:'failed', error:String(error?.message || error || 'TOOL_FAILED').slice(0,700) },
          ...(currentSession?.supportsNonBlocking ? { scheduling:'WHEN_IDLE' } : {})
        };
      } finally { pendingToolCalls = Math.max(0, pendingToolCalls - 1); }
    }));
    sendToolResponses(responses);
    if (!assistantSpeaking && pendingToolCalls === 0) transition('listening');
  }

  function scheduleFinalizeTurn() {
    if (finalizeTimer) clearTimeout(finalizeTimer);
    turn.turnCompleteAt = performance.now();
    finalizeTimer = setTimeout(() => {
      finalizeTimer = null;
      const snapshot = { ...turn };
      turn = freshTurn();
      rescueText = '';
      rescueSent = false;
      waitingForInput = false;
      hardRecoveryStarted = false;
      emitTranscript();
      if (snapshot.finalInput || snapshot.outputText) void persistTurn(snapshot.finalInput, snapshot.outputText);
      if (snapshot.firstInputAt) {
        reportMetric('turn', {
          inputToFirstModelMs: snapshot.firstModelAt ? Math.round(snapshot.firstModelAt - snapshot.firstInputAt) : null,
          inputToFirstAudioMs: snapshot.firstAudioAt ? Math.round(snapshot.firstAudioAt - snapshot.firstInputAt) : null,
          rescued: Boolean(snapshot._rescued)
        });
      }
      if (!assistantSpeaking && pendingToolCalls === 0 && sessionActive) transition('listening');
    }, TURN_SETTLE_MS);
  }

  function markModelActivity() {
    const now = performance.now();
    lastModelActivityAt = now;
    if (!turn.firstModelAt) turn.firstModelAt = now;
    hardRecoveryStarted = false;
  }

  function rescueTurn() {
    if (!sessionActive || !setupComplete || rescueSent || assistantSpeaking || pendingToolCalls > 0 || localVoiceActive) return false;
    const text = String(turn.finalInput || turn.interimInput || '').trim();
    if (text.length < 2) return false;
    rescueSent = true;
    rescueText = text;
    turn._rescued = true;
    transition('thinking', { label:'Confirmando o que você disse...' });
    const instruction = `Transcrição confirmada da fala que acabou de chegar pelo áudio: ${text}\nResponda a essa fala agora. Não mencione esta nota nem diga que recebeu uma transcrição.`;
    const sent = sendRealtime({ text: instruction });
    if (sent) reportMetric('text_rescue', { chars:text.length, waitingForInput });
    return sent;
  }

  function hardRecover() {
    if (!sessionActive || hardRecoveryStarted || assistantSpeaking || pendingToolCalls > 0 || localVoiceActive) return;
    hardRecoveryStarted = true;
    rescueText = String(turn.finalInput || turn.interimInput || rescueText || '').trim();
    transition('recovering');
    try { websocket?.close(4001, 'stalled-turn'); } catch {}
  }

  function scheduleReconnect(reason = 'reconnect') {
    if (!sessionActive || reconnectTimer) return;
    setupComplete = false;
    const delay = reconnectRequested ? 120 : Math.min(3500, 300 * (2 ** Math.min(reconnectAttempts, 4)));
    reconnectAttempts += 1;
    transition('recovering');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectLive(reason);
    }, delay);
  }

  async function handleServerMessage(event, socket) {
    if (socket !== websocket && socket !== connectingSocket) return;
    let raw = event.data;
    if (raw instanceof Blob) raw = await raw.text();
    if (raw instanceof ArrayBuffer) raw = new TextDecoder().decode(raw);
    let message;
    try { message = JSON.parse(raw); }
    catch { return; }
    lastServerAt = performance.now();

    if (message.setupComplete) {
      setupComplete = true;
      reconnectAttempts = 0;
      reconnectRequested = false;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      handshakeTimer = null;
      try { await startMicrophone(); }
      catch (error) {
        console.error('[SEXTA v5] microfone:', error);
        transition('error', { label:'Não consegui abrir o microfone.' });
        return;
      }
      if (rescueText) {
        const pending = rescueText;
        rescueText = '';
        setTimeout(() => {
          if (!sessionActive || !setupComplete) return;
          sendRealtime({ text:`O usuário acabou de dizer: ${pending}\nResponda diretamente a essa fala.` });
          transition('thinking');
        }, 180);
      }
      return;
    }

    if (message.sessionResumptionUpdate) {
      const update = message.sessionResumptionUpdate;
      if (update.resumable && update.newHandle) resumptionHandle = String(update.newHandle);
      return;
    }

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
        if (!turn.firstInputAt) turn.firstInputAt = performance.now();
        turn.interimInput = text;
        emitTranscript();
        if (!assistantSpeaking && localVoiceActive) transition('user_speaking');
      }
    }

    if (content.inputTranscription?.text) {
      const incoming = String(content.inputTranscription.text || '').trim();
      if (incoming) {
        if (!turn.firstInputAt) turn.firstInputAt = performance.now();
        turn.finalInput = mergeTranscript(turn.finalInput, incoming);
        turn.interimInput = '';
        emitTranscript();
        if (isVoiceOffCommand(turn.finalInput)) {
          stopVoice();
          return;
        }
        if (!assistantSpeaking && !localVoiceActive) transition('thinking');
      }
    }

    if (content.waitingForInput) {
      waitingForInput = true;
      assistantSpeaking = false;
      if (!localVoiceActive) transition('listening', { label:'Ouvindo — pode continuar.' });
    }

    if (content.interrupted) {
      stopOutput();
      assistantSpeaking = false;
      waitingForInput = false;
      transition(localVoiceActive ? 'user_speaking' : 'listening');
    }

    if (content.outputTranscription?.text) {
      markModelActivity();
      turn.outputText = mergeTranscript(turn.outputText, content.outputTranscription.text);
    }

    const parts = content.modelTurn?.parts || [];
    for (const part of parts) {
      if (!part?.inlineData?.data || !sessionActive) continue;
      markModelActivity();
      if (!turn.firstAudioAt) turn.firstAudioAt = performance.now();
      waitingForInput = false;
      assistantSpeaking = true;
      transition('speaking');
      await scheduleOutput(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
    }

    if (content.turnComplete) {
      scheduleFinalizeTurn();
    }
  }

  async function connectLive(reason = 'initial') {
    if (!sessionActive || connectingSocket || (websocket?.readyState === WebSocket.OPEN && setupComplete)) return;
    transition(reason === 'initial' ? 'connecting' : 'recovering');
    try {
      if (!cachedInstruction) cachedInstruction = await buildSystemInstruction();
      if (!sessionActive) return;
      const session = await api('/api/live-token', {
        method:'POST',
        body:JSON.stringify({ systemInstruction:cachedInstruction, origin:ORIGIN, resumptionHandle:resumptionHandle || '' })
      });
      if (!session?.token) throw new Error('token Live vazio');
      currentSession = session;
      const socket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(session.token)}`);
      connectingSocket = socket;

      socket.onopen = () => {
        if (!sessionActive) { try { socket.close(1000,'off'); } catch {} return; }
        websocket = socket;
        connectingSocket = null;
        const setup = {
          model:`models/${session.model}`,
          generationConfig:{
            responseModalities:['AUDIO'],
            thinkingConfig:{ thinkingBudget:Number(session.thinkingBudget ?? 0) },
            speechConfig:{ voiceConfig:{ prebuiltVoiceConfig:{ voiceName:session.voice } } }
          },
          realtimeInputConfig:session.realtimeInputConfig,
          tools:session.tools || [],
          inputAudioTranscription:session.inputAudioTranscription || {},
          outputAudioTranscription:session.outputAudioTranscription || {},
          contextWindowCompression:session.contextWindowCompression || { slidingWindow:{} },
          sessionResumption:session.sessionResumption || {}
        };
        socket.send(JSON.stringify({ setup }));
        if (handshakeTimer) clearTimeout(handshakeTimer);
        handshakeTimer = setTimeout(() => {
          if (sessionActive && socket === websocket && !setupComplete) {
            try { socket.close(4000,'handshake-timeout'); } catch {}
          }
        }, 10000);
      };

      socket.onmessage = event => { void handleServerMessage(event, socket); };
      socket.onerror = event => console.warn('[SEXTA v5] websocket:', event);
      socket.onclose = event => {
        if (connectingSocket === socket) connectingSocket = null;
        if (websocket === socket) websocket = null;
        setupComplete = false;
        if (handshakeTimer) clearTimeout(handshakeTimer);
        handshakeTimer = null;
        stopOutput();
        if (!sessionActive) return;
        if (resumptionHandle && Number(event?.code || 0) >= 4000) resumptionHandle = '';
        scheduleReconnect(reconnectRequested ? 'goaway' : 'socket-close');
      };
    } catch (error) {
      connectingSocket = null;
      console.error('[SEXTA v5] conexão:', error);
      if (sessionActive) scheduleReconnect('connect-error');
    }
  }

  function cleanup(closeSocket = true) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (handshakeTimer) clearTimeout(handshakeTimer);
    if (finalizeTimer) clearTimeout(finalizeTimer);
    reconnectTimer = handshakeTimer = finalizeTimer = null;
    setupComplete = false;
    pendingToolCalls = 0;
    waitingForInput = false;
    reconnectAttempts = 0;
    reconnectRequested = false;
    currentSession = null;
    cachedInstruction = '';
    rescueText = '';
    rescueSent = false;
    hardRecoveryStarted = false;
    stopMicrophone();
    stopOutput();
    if (closeSocket) {
      try { connectingSocket?.close(1000,'voice-off'); } catch {}
      try { websocket?.close(1000,'voice-off'); } catch {}
    }
    connectingSocket = websocket = null;
    turn = freshTurn();
    emitTranscript();
  }

  async function startVoice() {
    if (sessionActive) return;
    if (!AudioContextCtor || !window.AudioWorkletNode) {
      transition('error', { label:'Este navegador não suporta o Voice Core v5.' });
      return;
    }
    sessionActive = true;
    turn = freshTurn();
    lastModelActivityAt = performance.now();
    lastServerAt = performance.now();
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

  // Stalled-turn detector. It never decides normal end-of-turn; Gemini VAD remains
  // authoritative. It only rescues a turn after we have actual transcript evidence.
  setInterval(() => {
    if (!sessionActive || !setupComplete || assistantSpeaking || pendingToolCalls > 0 || localVoiceActive) return;
    const text = String(turn.finalInput || turn.interimInput || '').trim();
    if (text.length < 2) return;
    const quietSince = localVoiceEndedAt || localLastVoiceAt || 0;
    if (!quietSince) return;
    const now = performance.now();
    const quietMs = now - quietSince;
    const modelIdleMs = now - (lastModelActivityAt || turn.firstInputAt || now);
    const rescueAt = waitingForInput || looksLikeCompleteRequest(text) ? FAST_RESCUE_DELAY_MS : RESCUE_DELAY_MS;
    if (!rescueSent && quietMs >= rescueAt && modelIdleMs >= rescueAt) {
      rescueTurn();
      return;
    }
    if (rescueSent && !hardRecoveryStarted && quietMs >= HARD_RECOVERY_MS && modelIdleMs >= HARD_RECOVERY_MS) {
      hardRecover();
    }
  }, 240);

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
      version:'voice-core-v5', platform:ORIGIN, state, sessionActive, setupComplete,
      captureEnabled, assistantSpeaking, pendingToolCalls, localVoiceActive,
      waitingForInput, interimTranscript:turn.interimInput, finalTranscript:turn.finalInput,
      outputTranscript:turn.outputText, rescueSent, resumptionReady:Boolean(resumptionHandle),
      noiseFloor, lastServerAt, lastModelActivityAt
    })
  };
})();
