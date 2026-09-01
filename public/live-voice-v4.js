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
  const OUTPUT_PREBUFFER_BASE = IS_ANDROID ? 0.13 : 0.055;
  const OUTPUT_PREBUFFER_MAX = IS_ANDROID ? 0.30 : 0.18;
  const OUTPUT_DRAIN_QUIET_MS = IS_ANDROID ? 180 : 100;
  const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
  const QUICK_SILENT_TOOLS = new Set([
    'android_open_app',
    'android_open_settings',
    'android_set_volume',
    'android_adjust_volume',
    'android_flashlight',
    'android_media',
    'pc_open_app',
    'pc_open_project',
    'pc_open_url'
  ]);

  let websocket = null;
  let connectingSocket = null;
  let mediaStream = null;
  let inputContext = null;
  let inputSource = null;
  let inputWorklet = null;
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
  let stoppingByVoice = false;
  let handshakeTimeout = null;
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let reconnectRequested = false;
  let resumptionHandle = '';
  let cachedInstruction = '';
  let currentSession = null;
  let pendingToolCalls = 0;
  let completionPending = false;
  const canceledToolIds = new Set();

  let inputTranscript = '';
  let interimTranscript = '';
  let outputTranscript = '';
  let waitingForInput = false;

  let noiseFloor = 0.006;
  let localVoiceActive = false;
  let localVoiceStartedAt = 0;
  let localLastVoiceAt = 0;
  let localLastVoiceEndAt = 0;
  let firstServerEventAt = 0;
  let firstAudioAt = 0;
  let outputUnderrunsAtTurnStart = 0;

  function setHint(text) {
    if (voiceHint && voiceHint.textContent !== text) voiceHint.textContent = text;
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

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function speechThreshold() {
    return Math.max(IS_ANDROID ? 0.012 : 0.009, noiseFloor * 3.0);
  }

  function updateNoiseFloor(level) {
    const maxQuiet = IS_ANDROID ? 0.026 : 0.019;
    if (!assistantSpeaking && level <= maxQuiet) noiseFloor = noiseFloor * 0.987 + level * 0.013;
  }

  function updateLocalActivity(samples) {
    const level = rms(samples);
    const now = performance.now();
    updateNoiseFloor(level);
    const active = level >= speechThreshold();

    if (active) {
      localLastVoiceAt = now;
      if (!localVoiceActive) {
        localVoiceActive = true;
        localVoiceStartedAt = now;
        firstServerEventAt = 0;
        firstAudioAt = 0;
        outputUnderrunsAtTurnStart = outputUnderruns;
      }
      if (!assistantSpeaking) setHint('SEXTA • te ouvindo...');
      return;
    }

    if (localVoiceActive && now - localLastVoiceAt >= 520) {
      localVoiceActive = false;
      localLastVoiceEndAt = localLastVoiceAt;
      if (!assistantSpeaking && !waitingForInput) setHint('SEXTA • ouvindo...');
    }
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
    }
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
      outputContext.onstatechange = () => {
        if (sessionActive && outputContext?.state === 'suspended' && !document.hidden) {
          void outputContext.resume().catch(() => {});
        }
      };
    }
    if (outputContext.state === 'suspended' && !document.hidden) await outputContext.resume();
    return outputContext;
  }

  function clearScheduledOutput() {
    for (const source of outputSources) {
      try { source.stop(); } catch {}
    }
    outputSources.clear();
    nextOutputTime = 0;
    lastOutputChunkAt = 0;
  }

  function stopOutput() {
    clearScheduledOutput();
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
      adaptivePrebuffer = Math.min(OUTPUT_PREBUFFER_MAX, adaptivePrebuffer + 0.024);
    }

    if (nextOutputTime < now + 0.010) nextOutputTime = now + adaptivePrebuffer;
    source.start(nextOutputTime);
    nextOutputTime += floats.length / sampleRate;
    lastOutputChunkAt = performance.now();
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function waitForOutputDrain() {
    const startedAt = performance.now();
    while (sessionActive && performance.now() - startedAt < 30000) {
      let ctx = outputContext;
      try { ctx = await ensureOutputContext(); } catch {}
      const scheduledTail = ctx ? Math.max(0, nextOutputTime - ctx.currentTime) : 0;
      const quietFor = lastOutputChunkAt ? performance.now() - lastOutputChunkAt : OUTPUT_DRAIN_QUIET_MS;
      if (outputSources.size === 0 && scheduledTail <= 0.02 && quietFor >= OUTPUT_DRAIN_QUIET_MS) return;
      await sleep(20);
    }
  }

  async function startMicrophone() {
    if (mediaStream && inputContext && inputWorklet) {
      captureEnabled = true;
      if (inputContext.state === 'suspended') await inputContext.resume();
      setHint('SEXTA • ouvindo...');
      return;
    }

    if (!AudioContextCtor) throw new Error('Web Audio indisponível');
    if (!window.AudioWorkletNode) throw new Error('AudioWorklet indisponível neste navegador');

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
    await inputContext.audioWorklet.addModule('/live-input-worklet.js');

    inputSource = inputContext.createMediaStreamSource(mediaStream);
    inputWorklet = new AudioWorkletNode(inputContext, 'sexta-mic-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
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
    setHint('SEXTA • ouvindo...');
  }

  function stopMicrophone() {
    captureEnabled = false;
    try { inputWorklet?.port && (inputWorklet.port.onmessage = null); } catch {}
    try { inputWorklet?.disconnect(); } catch {}
    try { inputSource?.disconnect(); } catch {}
    try { silentGain?.disconnect(); } catch {}
    for (const track of mediaStream?.getTracks?.() || []) track.stop();
    try { inputContext?.close(); } catch {}
    mediaStream = null;
    inputContext = null;
    inputSource = null;
    inputWorklet = null;
    silentGain = null;
    localVoiceActive = false;
  }

  async function buildSystemInstruction() {
    const conversationId = localStorage.getItem('sexta_conversation') || 'main';
    let sync = {};
    try { sync = await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}`); } catch {}
    const settings = sync.settings || {};
    const memories = (sync.memories || []).slice(0, 10).map(item => `- ${item.content}`).join('\n');
    const recent = (sync.messages || []).slice(-10).map(item => `${item.role === 'assistant' ? 'SEXTA' : 'USUÁRIO'}: ${item.content}`).join('\n');
    const platformRule = IS_ANDROID
      ? 'Você está rodando no Android. Use android_ para ações no aparelho atual. Só use pc_ se eu disser explicitamente PC/computador/Windows, exceto pc_codex_task e pc_codex_status quando eu pedir Codex/programação.'
      : IS_DESKTOP
        ? 'Você está rodando no PC. Use pc_ para ações no computador atual. Só use android_ se eu disser explicitamente celular/Android.'
        : 'Você está no navegador; escolha o dispositivo pelo contexto e pergunte apenas quando realmente estiver ambíguo.';

    return [
      'Você é SEXTA-feira, uma assistente pessoal de voz em uma conversa contínua e viva. Fale em português brasileiro natural, espontâneo e caloroso.',
      'PRESENÇA: enquanto o modo Live estiver ativo, você já está presente na conversa. O usuário NÃO precisa dizer “Sexta-feira” antes de cada fala. Comentários, desabafos, piadas e observações naturais podem merecer resposta mesmo quando não são perguntas formais.',
      'ESCUTA: o microfone é contínuo. Não trate toda pausa curta, hesitação, “eu...”, “mas...”, “pera...” ou frase quebrada como uma nova solicitação. Se parecer que o usuário ainda vai continuar, espere. Não preencha o silêncio por ansiedade.',
      'INTERRUPÇÃO: se o usuário começar a falar enquanto você fala, ceda a vez imediatamente. Não exija palavra de ativação para interrupção. Retome apenas se fizer sentido depois da fala dele.',
      'RITMO: numa conversa casual, prefira uma ou duas frases e deixe espaço para o usuário entrar. Não termine toda resposta com uma pergunta. Não use “como posso ajudar?” no meio de uma conversa já em andamento.',
      'NATURALIDADE: use reações curtas, humor e pequenas confirmações quando combinarem com o momento, mas não crie bordões nem repita “chefe” mecanicamente. Não narre estados internos ou “executando ferramenta”.',
      'CONTEXTO: acompanhe pronomes, referências curtas, mudanças de assunto e retomadas como numa conversa humana. Não peça para repetir algo que está claro pelo contexto recente.',
      'RUÍDO: se perceber fala ambiente irrelevante ou algo que claramente não pede sua participação, pode ficar em silêncio. Se houver dúvida real, prefira uma reação curta a uma resposta longa.',
      platformRule,
      'FERRAMENTAS: quando houver ferramenta adequada, use-a. Ações rápidas devem acontecer sem discurso prévio. Se uma ação puder rodar em segundo plano, continue a conversa normalmente. Nunca diga que terminou antes da confirmação real.',
      'CODEX: use pc_codex_task quando o usuário pedir análise/correção/programação num projeto configurado. mode=analyze não altera arquivos; mode=edit só quando ele pedir alteração. A tarefa inicia em background; não diga que terminou enquanto pc_codex_status não confirmar completed.',
      'GMAIL: para ler e-mails use google_unread_email. Para abrir Gmail no Android use android_open_app com app gmail; no PC use pc_open_url com https://mail.google.com/.',
      'VOZ: mantenha identidade vocal feminina consistente durante toda a sessão.',
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
          deviceId: localStorage.getItem('sexta_device_id') || 'live-browser',
          userText: cleanUser,
          assistantText: cleanAssistant
        })
      });
    } catch (error) {
      console.warn('Não consegui salvar o turno Live:', error);
    }
  }

  function reportTurnMetrics(snapshot) {
    if (!snapshot) return;
    const payload = {
      kind: 'voice_core_v4',
      platform: ORIGIN,
      speechEndToFirstAudioMs: snapshot.firstAudioAt && snapshot.localLastVoiceEndAt
        ? Math.max(0, Math.round(snapshot.firstAudioAt - snapshot.localLastVoiceEndAt))
        : null,
      speechStartToFirstAudioMs: snapshot.firstAudioAt && snapshot.localVoiceStartedAt
        ? Math.max(0, Math.round(snapshot.firstAudioAt - snapshot.localVoiceStartedAt))
        : null,
      firstServerEventMs: snapshot.firstServerEventAt && snapshot.localVoiceStartedAt
        ? Math.max(0, Math.round(snapshot.firstServerEventAt - snapshot.localVoiceStartedAt))
        : null,
      outputUnderruns: Math.max(0, snapshot.outputUnderruns - snapshot.outputUnderrunsAtTurnStart),
      prebufferMs: Math.round(adaptivePrebuffer * 1000),
      waitingForInput: Boolean(snapshot.waitingForInput),
      continuousInput: true
    };
    void api('/api/live-metrics', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
  }

  function resetTurnState() {
    inputTranscript = '';
    interimTranscript = '';
    outputTranscript = '';
    waitingForInput = false;
    firstServerEventAt = 0;
    firstAudioAt = 0;
    localVoiceStartedAt = 0;
    localLastVoiceEndAt = 0;
    outputUnderrunsAtTurnStart = outputUnderruns;
    completionPending = false;
  }

  async function executeLiveTool(call) {
    const name = String(call?.name || '').trim();
    const args = call?.args && typeof call.args === 'object' ? call.args : {};
    const deviceId = localStorage.getItem('sexta_device_id') || (IS_ANDROID ? 'android-native' : 'live-browser');
    if (!name) return { ok: false, handled: true, state: 'failed', error: 'TOOL_NAME_MISSING' };

    const plugin = window.Capacitor?.Plugins?.LiveToolBridge || null;
    const localAndroid = IS_ANDROID && name.startsWith('android_') && plugin?.execute;

    if (localAndroid) {
      const planned = await api('/api/tool-execute', {
        method: 'POST',
        body: JSON.stringify({ name, args, deviceId, preferLocalAndroid: true, origin: ORIGIN })
      });
      if (planned?.clientAction?.action) {
        const result = await plugin.execute({ action: planned.clientAction.action, payload: planned.clientAction.payload || {} });
        return { ...result, tool: name, scope: 'android-local', state: result?.ok === false ? 'failed' : 'completed' };
      }
      return planned;
    }

    return api('/api/tool-execute', {
      method: 'POST',
      body: JSON.stringify({ name, args, deviceId, preferLocalAndroid: false, origin: ORIGIN })
    });
  }

  function sendToolResponse(functionResponses) {
    if (!functionResponses?.length || websocket?.readyState !== WebSocket.OPEN || !setupComplete || !sessionActive) return;
    websocket.send(JSON.stringify({ toolResponse: { functionResponses } }));
  }

  async function handleToolCall(toolCall) {
    const calls = Array.isArray(toolCall?.functionCalls) ? toolCall.functionCalls : [];
    if (!calls.length || !sessionActive) return;
    pendingToolCalls += calls.length;
    setHint(calls.length > 1 ? `SEXTA • ${calls.length} ações em andamento...` : 'SEXTA • ação em andamento...');

    const responses = await Promise.all(calls.map(async call => {
      try {
        const result = await executeLiveTool(call);
        if (canceledToolIds.has(call.id)) return null;
        const response = { id: call.id, name: call.name, response: result ?? { ok: true, state: 'completed' } };
        if (currentSession?.supportsNonBlocking) {
          response.scheduling = QUICK_SILENT_TOOLS.has(call.name) ? 'SILENT' : 'WHEN_IDLE';
        }
        return response;
      } catch (error) {
        if (canceledToolIds.has(call.id)) return null;
        return {
          id: call.id,
          name: call.name,
          response: {
            ok: false,
            handled: true,
            state: 'failed',
            error: String(error?.message || error || 'TOOL_FAILED').slice(0, 700)
          },
          ...(currentSession?.supportsNonBlocking ? { scheduling: 'WHEN_IDLE' } : {})
        };
      } finally {
        pendingToolCalls = Math.max(0, pendingToolCalls - 1);
      }
    }));

    if (!sessionActive) return;
    sendToolResponse(responses.filter(Boolean));
    for (const call of calls) canceledToolIds.delete(call.id);
    if (pendingToolCalls === 0) {
      if (completionPending) completeCurrentTurn();
      else if (!assistantSpeaking) setHint(waitingForInput ? 'SEXTA • te ouvindo...' : 'SEXTA • ouvindo...');
    }
  }

  function completeCurrentTurn() {
    if (!sessionActive) return;
    if (pendingToolCalls > 0) {
      completionPending = true;
      return;
    }

    const snapshot = {
      userText: inputTranscript,
      assistantText: outputTranscript,
      localVoiceStartedAt,
      localLastVoiceEndAt,
      firstServerEventAt,
      firstAudioAt,
      outputUnderruns,
      outputUnderrunsAtTurnStart,
      waitingForInput
    };

    resetTurnState();
    void (async () => {
      if (assistantSpeaking) await waitForOutputDrain();
      if (!sessionActive) return;
      assistantSpeaking = false;
      if (snapshot.userText || snapshot.assistantText) void persistTurn(snapshot.userText, snapshot.assistantText);
      reportTurnMetrics(snapshot);
      const turnUnderruns = Math.max(0, snapshot.outputUnderruns - snapshot.outputUnderrunsAtTurnStart);
      if (turnUnderruns === 0 && adaptivePrebuffer > OUTPUT_PREBUFFER_BASE) {
        adaptivePrebuffer = Math.max(OUTPUT_PREBUFFER_BASE, adaptivePrebuffer - 0.010);
      }
      if (pendingToolCalls === 0) setHint('SEXTA • ouvindo...');
    })();
  }

  function scheduleReconnect(reason = 'reconnect') {
    if (!sessionActive || stoppingByVoice || reconnectTimer) return;
    setupComplete = false;
    const delay = reconnectRequested ? 120 : Math.min(4000, 350 * (2 ** Math.min(reconnectAttempts, 4)));
    reconnectAttempts += 1;
    setHint('SEXTA • reconectando...');
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
    catch (error) { console.warn('Mensagem Live não-JSON:', raw, error); return; }

    if (message.setupComplete) {
      setupComplete = true;
      reconnectAttempts = 0;
      reconnectRequested = false;
      if (handshakeTimeout) clearTimeout(handshakeTimeout);
      handshakeTimeout = null;
      setHint('SEXTA • entrando na conversa...');
      try { await startMicrophone(); }
      catch (error) {
        console.error('Microfone Live v4:', error);
        setHint(`Microfone indisponível • ${error?.name || 'erro'}`);
        deactivateVoiceMode();
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
      setHint('SEXTA • mantendo a conversa...');
      try { socket.close(1000, 'goaway-reconnect'); } catch {}
      return;
    }

    if (!firstServerEventAt && localVoiceStartedAt) firstServerEventAt = performance.now();

    if (message.toolCall) {
      void handleToolCall(message.toolCall);
      return;
    }

    if (message.toolCallCancellation) {
      for (const id of message.toolCallCancellation.ids || []) canceledToolIds.add(id);
      return;
    }

    const content = message.serverContent;
    if (!content) return;

    if (content.interimInputTranscription?.text) {
      interimTranscript = String(content.interimInputTranscription.text || '').trim();
      if (!assistantSpeaking && interimTranscript) setHint('SEXTA • te ouvindo...');
    }

    if (content.inputTranscription?.text) {
      const incoming = content.inputTranscription.text;
      inputTranscript = mergeTranscript(inputTranscript, incoming);
      interimTranscript = '';
      if (isVoiceOffCommand(incoming) || isVoiceOffCommand(inputTranscript)) {
        deactivateVoiceMode({ spoken: true });
        return;
      }
    }

    if (content.outputTranscription?.text) {
      outputTranscript = mergeTranscript(outputTranscript, content.outputTranscription.text);
    }

    if (content.waitingForInput) {
      waitingForInput = true;
      assistantSpeaking = false;
      setHint('SEXTA • te ouvindo...');
    }

    if (content.interrupted) {
      stopOutput();
      assistantSpeaking = false;
      waitingForInput = false;
      setHint('SEXTA • te ouvindo...');
    }

    const parts = content.modelTurn?.parts || [];
    for (const part of parts) {
      if (!part?.inlineData?.data || !sessionActive) continue;
      if (!firstAudioAt) {
        firstAudioAt = performance.now();
        console.debug('[SEXTA Live v4] primeiro áudio', {
          fromLocalSpeechEndMs: localLastVoiceEndAt ? Math.max(0, Math.round(firstAudioAt - localLastVoiceEndAt)) : null,
          fromLocalSpeechStartMs: localVoiceStartedAt ? Math.max(0, Math.round(firstAudioAt - localVoiceStartedAt)) : null,
          prebufferMs: Math.round(adaptivePrebuffer * 1000)
        });
      }
      waitingForInput = false;
      assistantSpeaking = true;
      setHint('SEXTA • falando...');
      await scheduleOutput(part.inlineData.data, part.inlineData.mimeType || 'audio/pcm;rate=24000');
    }

    if (content.turnComplete) {
      completeCurrentTurn();
    }
  }

  async function connectLive(reason = 'initial') {
    if (!sessionActive || connectingSocket || (websocket && websocket.readyState === WebSocket.OPEN && setupComplete)) return;
    try {
      if (!cachedInstruction) cachedInstruction = await buildSystemInstruction();
      if (!sessionActive) return;

      const session = await api('/api/live-token', {
        method: 'POST',
        body: JSON.stringify({
          systemInstruction: cachedInstruction,
          origin: ORIGIN,
          resumptionHandle: resumptionHandle || ''
        })
      });
      if (!session?.token) throw new Error('token Live vazio');
      currentSession = session;
      if (!sessionActive) return;

      setHint(reason === 'initial' ? 'SEXTA • conectando...' : 'SEXTA • retomando conversa...');
      const socket = new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(session.token)}`);
      connectingSocket = socket;

      socket.onopen = () => {
        if (!sessionActive) {
          try { socket.close(1000, 'voice mode off'); } catch {}
          return;
        }
        websocket = socket;
        connectingSocket = null;
        const setup = {
          model: `models/${session.model}`,
          generationConfig: {
            responseModalities: ['AUDIO'],
            thinkingConfig: { thinkingBudget: Number(session.thinkingBudget ?? 0) },
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: session.voice } } }
          },
          realtimeInputConfig: session.realtimeInputConfig,
          tools: session.tools || [],
          inputAudioTranscription: session.inputAudioTranscription || {},
          outputAudioTranscription: session.outputAudioTranscription || {},
          contextWindowCompression: session.contextWindowCompression || { slidingWindow: {} },
          sessionResumption: session.sessionResumption || {}
        };
        if (session.enableAffectiveDialog) setup.enableAffectiveDialog = true;
        if (session.proactivity) setup.proactivity = session.proactivity;
        socket.send(JSON.stringify({ setup }));

        if (handshakeTimeout) clearTimeout(handshakeTimeout);
        handshakeTimeout = setTimeout(() => {
          if (sessionActive && socket === websocket && !setupComplete) {
            console.warn('SEXTA Live v4 timeout no handshake');
            try { socket.close(4000, 'handshake-timeout'); } catch {}
          }
        }, 12000);
      };

      socket.onmessage = event => { void handleServerMessage(event, socket); };
      socket.onerror = event => {
        if (sessionActive) console.warn('Gemini Live v4 WebSocket error:', event);
      };
      socket.onclose = event => {
        if (connectingSocket === socket) connectingSocket = null;
        if (websocket === socket) websocket = null;
        setupComplete = false;
        if (handshakeTimeout) clearTimeout(handshakeTimeout);
        handshakeTimeout = null;
        if (!sessionActive || stoppingByVoice) return;

        const code = event?.code || 0;
        const reasonText = String(event?.reason || '').trim();
        console.warn('Gemini Live v4 fechado:', code, reasonText);
        stopOutput();

        if (resumptionHandle && code >= 4000) resumptionHandle = '';
        scheduleReconnect(reconnectRequested ? 'goaway' : 'socket-close');
      };
    } catch (error) {
      connectingSocket = null;
      console.error('SEXTA Live v4 connect:', error);
      if (sessionActive) scheduleReconnect('connect-error');
    }
  }

  function cleanupSession(closeSocket = true) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (handshakeTimeout) clearTimeout(handshakeTimeout);
    handshakeTimeout = null;
    setupComplete = false;
    captureEnabled = false;
    assistantSpeaking = false;
    pendingToolCalls = 0;
    completionPending = false;
    canceledToolIds.clear();
    reconnectAttempts = 0;
    reconnectRequested = false;
    resumptionHandle = '';
    cachedInstruction = '';
    currentSession = null;
    stopMicrophone();
    stopOutput();
    if (closeSocket) {
      try { connectingSocket?.close(1000, 'voice mode off'); } catch {}
      try { websocket?.close(1000, 'voice mode off'); } catch {}
    }
    connectingSocket = null;
    websocket = null;
    resetTurnState();
    setActiveUI(false);
  }

  function deactivateVoiceMode({ spoken = false } = {}) {
    if (!sessionActive) return;
    stoppingByVoice = spoken;
    if (websocket?.readyState === WebSocket.OPEN && setupComplete && captureEnabled) {
      try { sendRealtime({ audioStreamEnd: true }); } catch {}
    }
    const userText = inputTranscript;
    sessionActive = false;
    if (spoken && userText) void persistTurn(userText, '');
    cleanupSession(true);
    setHint(spoken ? 'Modo de voz desativado' : 'SEXTA Live pronta');
    stoppingByVoice = false;
  }

  async function activateVoiceMode() {
    if (sessionActive) return;
    if (!AudioContextCtor) {
      setHint('Web Audio indisponível');
      return;
    }
    if (!window.AudioWorkletNode) {
      console.warn('AudioWorklet não suportado; carregando Voice Core v3.');
      setHint('Abrindo modo compatível...');
      try {
        await import('./live-voice-v3.js');
        window.__sextaGeminiLive?.start?.();
      } catch (error) {
        console.error('Fallback v3 falhou:', error);
        setHint('Modo de voz indisponível');
      }
      return;
    }

    sessionActive = true;
    stoppingByVoice = false;
    adaptivePrebuffer = OUTPUT_PREBUFFER_BASE;
    nextOutputTime = 0;
    resetTurnState();
    setActiveUI(true);
    setHint('SEXTA • entrando na conversa...');
    await connectLive('initial');
  }

  function toggleVoiceMode() {
    if (sessionActive) deactivateVoiceMode();
    else void activateVoiceMode();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && sessionActive) {
      void ensureOutputContext().catch(() => {});
      if (inputContext?.state === 'suspended') void inputContext.resume().catch(() => {});
    }
  });

  voiceBtn.onclick = toggleVoiceMode;
  voiceBtn.title = 'Ativar/desativar conversa contínua com a SEXTA';
  if (wakeBtn) {
    wakeBtn.onclick = toggleVoiceMode;
    wakeBtn.title = 'Ativar/desativar conversa contínua com a SEXTA';
  }

  setHint('SEXTA Live pronta');
  window.__sextaGeminiLive = {
    start: activateVoiceMode,
    stop: () => deactivateVoiceMode(),
    toggle: toggleVoiceMode,
    active: () => sessionActive,
    debug: () => ({
      version: 'voice-core-v4',
      platform: ORIGIN,
      sessionActive,
      setupComplete,
      captureEnabled,
      assistantSpeaking,
      waitingForInput,
      localVoiceActive,
      noiseFloor,
      adaptivePrebuffer,
      outputUnderruns,
      pendingToolCalls,
      resumptionReady: Boolean(resumptionHandle),
      continuousInput: true,
      interimTranscript
    })
  };
})();
