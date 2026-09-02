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
  const LOCAL_SPEECH_HANGOVER_MS = 320;
  const HYBRID_FINALIZE_DELAY_MS = 120;
  const TURN_SETTLE_MS = 700;
  const RESCUE_MS = 4200;
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
  let finalizeTimer = null;
  let hybridTimer = null;
  let reconnectAttempts = 0;
  let reconnectRequested = false;
  let resumptionHandle = '';
  let cachedInstruction = '';
  let currentSession = null;
  let pendingToolCalls = 0;
  let waitingForInput = false;

  let mediaStream = null;
  let inputContext = null;
  let inputSource = null;
  let inputWorklet = null;
  let silentGain = null;
  let resampler = null;
  let captureEnabled = false;
  let noiseFloor = 0.005;
  let localVoiceActive = false;
  let localLastVoiceAt = 0;
  let localVoiceEndedAt = 0;

  let outputContext = null;
  let nextOutputTime = 0;
  const outputSources = new Set();
  let assistantSpeaking = false;

  let turn = freshTurn();
  let rescueSent = false;
  let rescueText = '';
  let hardRecoveryStarted = false;
  let lastModelActivityAt = 0;
  let lastServerAt = 0;

  function freshTurn() {
    return {
      interimInput: '', finalInput: '', outputText: '',
      localSpeechStartAt: 0, firstInterimAt: 0, firstFinalAt: 0,
      firstModelAt: 0, firstAudioAt: 0, hybridFinalized: false
    };
  }

  function emit(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function transition(next, extra = {}) {
    state = next;
    emit('sexta:voice-state', { state, sessionActive, setupComplete, assistantSpeaking, pendingToolCalls, ...extra });
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
    void api('/api/live-metrics', { method:'POST', body:JSON.stringify({ kind:`voice_core_v6:${kind}`, platform:ORIGIN, state, ...extra }) }).catch(() => {});
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
    const a = normalizeSpeech(current), b = normalizeSpeech(next);
    if (a === b || a.endsWith(b)) return current;
    if (b.startsWith(a)) return next;
    return `${current} ${next}`.replace(/\s+/g,' ').trim();
  }

  function looksComplete(text = '') {
    const raw = String(text).trim();
    const value = normalizeSpeech(raw);
    if (!value) return false;
    if (/[?!.]$/.test(raw)) return true;
    return /^(?:sexta(?: feira)?\s+)?(?:como|qual|quais|quem|onde|quando|por que|porque|o que|ta ai|t[aá] ai|abre|abra|fecha|feche|faz|fa[cç]a|me fala|me diga|me diz|mostra|procura|pesquisa|manda|envia|liga|desliga|aumenta|abaixa|analisa|corrige)\b/.test(value);
  }

  function isVoiceOffCommand(text = '') {
    const value = normalizeSpeech(text).replace(/^sexta(?: feira)?\s+/,'');
    return /^(?:desativar|desative|desliga|desligue|desligar|encerrar|encerre|fechar|fecha|pare|parar)\s+(?:o\s+)?modo\s+de\s+voz$/.test(value)
      || /^(?:sair|saia)\s+do\s+modo\s+de\s+voz$/.test(value)
      || /^(?:desativar|desative|desliga|desligue|desligar)\s+(?:a\s+)?voz$/.test(value);
  }

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i=0;i<samples.length;i+=1) sum += samples[i]*samples[i];
    return Math.sqrt(sum/samples.length);
  }

  function speechThreshold() {
    return Math.max(IS_ANDROID ? 0.012 : 0.0075, noiseFloor * 2.7);
  }

  function sendRealtime(payload) {
    if (websocket?.readyState === WebSocket.OPEN && setupComplete && sessionActive) {
      websocket.send(JSON.stringify({ realtimeInput:payload }));
      return true;
    }
    return false;
  }

  function scheduleHybridFinalize() {
    if (hybridTimer) clearTimeout(hybridTimer);
    hybridTimer = setTimeout(() => {
      hybridTimer = null;
      if (!sessionActive || !setupComplete || localVoiceActive || assistantSpeaking || pendingToolCalls > 0) return;
      const text = String(turn.finalInput || turn.interimInput || '').trim();
      if (!looksComplete(text) || turn.hybridFinalized) return;
      if (sendRealtime({ audioStreamEnd:true })) {
        turn.hybridFinalized = true;
        reportMetric('hybrid_end', { chars:text.length });
        transition('thinking');
      }
    }, HYBRID_FINALIZE_DELAY_MS);
  }

  function updateLocalActivity(samples) {
    const level = rms(samples);
    const now = performance.now();
    if (!assistantSpeaking && level < 0.018) noiseFloor = noiseFloor*0.992 + level*0.008;
    const active = level >= speechThreshold();
    if (active) {
      localLastVoiceAt = now;
      if (!localVoiceActive) {
        localVoiceActive = true;
        localVoiceEndedAt = 0;
        if (!turn.localSpeechStartAt) turn.localSpeechStartAt = now;
        if (hybridTimer) clearTimeout(hybridTimer);
        hybridTimer = null;
        if (!assistantSpeaking) transition('user_speaking');
      }
      return;
    }
    if (localVoiceActive && now-localLastVoiceAt >= LOCAL_SPEECH_HANGOVER_MS) {
      localVoiceActive = false;
      localVoiceEndedAt = localLastVoiceAt;
      if (!assistantSpeaking && pendingToolCalls === 0) transition('thinking');
      scheduleHybridFinalize();
    }
  }

  function floatToPcm16(float32) {
    const out = new Int16Array(float32.length);
    for (let i=0;i<float32.length;i+=1) {
      const v = Math.max(-1,Math.min(1,float32[i]));
      out[i] = v < 0 ? Math.round(v*32768) : Math.round(v*32767);
    }
    return new Uint8Array(out.buffer);
  }

  function bytesToBase64(bytes) {
    let binary='';
    for(let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary=atob(value); const bytes=new Uint8Array(binary.length);
    for(let i=0;i<bytes.length;i+=1) bytes[i]=binary.charCodeAt(i);
    return bytes;
  }

  function pcm16ToFloat32(bytes) {
    const count=Math.floor(bytes.byteLength/2);
    const view=new DataView(bytes.buffer,bytes.byteOffset,count*2);
    const out=new Float32Array(count);
    for(let i=0;i<count;i+=1){const s=view.getInt16(i*2,true);out[i]=s<0?s/32768:s/32767;}
    return out;
  }

  function sendPcmFrame(raw) {
    if (!captureEnabled || !sessionActive || !setupComplete || !resampler) return;
    const pcm16k = resampler.process(raw);
    if (!pcm16k.length) return;
    updateLocalActivity(pcm16k);
    const bytes=floatToPcm16(pcm16k);
    sendRealtime({ audio:{ data:bytesToBase64(bytes), mimeType:`audio/pcm;rate=${INPUT_RATE}` } });
  }

  async function ensureOutputContext() {
    if (!AudioContextCtor) throw new Error('Web Audio indisponível');
    if (!outputContext || outputContext.state === 'closed') outputContext=new AudioContextCtor({latencyHint:'interactive',sampleRate:OUTPUT_RATE});
    if (outputContext.state === 'suspended' && !document.hidden) await outputContext.resume();
    return outputContext;
  }

  function stopOutput() {
    for(const source of outputSources){try{source.stop();}catch{}}
    outputSources.clear(); nextOutputTime=0; assistantSpeaking=false;
  }

  async function scheduleOutput(base64,mimeType='') {
    const bytes=base64ToBytes(base64); if(!bytes.length || !sessionActive) return;
    const sampleRate=Number(String(mimeType).match(/rate=(\d+)/i)?.[1] || OUTPUT_RATE);
    const ctx=await ensureOutputContext(); const floats=pcm16ToFloat32(bytes);
    const buffer=ctx.createBuffer(1,floats.length,sampleRate); buffer.copyToChannel(floats,0);
    const source=ctx.createBufferSource(); source.buffer=buffer; source.connect(ctx.destination); outputSources.add(source);
    source.onended=()=>outputSources.delete(source);
    const now=ctx.currentTime; if(nextOutputTime<now+0.008) nextOutputTime=now+OUTPUT_PREBUFFER;
    source.start(nextOutputTime); nextOutputTime += floats.length/sampleRate;
  }

  async function startMicrophone() {
    if (mediaStream && inputContext && inputWorklet) {
      captureEnabled=true; if(inputContext.state==='suspended') await inputContext.resume(); transition('listening'); return;
    }
    mediaStream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true,latency:{ideal:0.01}}});
    const track=mediaStream.getAudioTracks?.()[0];
    const settings=track?.getSettings?.() || {};
    inputContext=new AudioContextCtor({latencyHint:'interactive'});
    if(inputContext.state==='suspended') await inputContext.resume();
    resampler=new StreamingSincResampler(inputContext.sampleRate,INPUT_RATE,{radius:16,cutoffScale:0.92});
    await inputContext.audioWorklet.addModule('/live-input-worklet.js');
    inputSource=inputContext.createMediaStreamSource(mediaStream);
    inputWorklet=new AudioWorkletNode(inputContext,'sexta-mic-processor',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    silentGain=inputContext.createGain(); silentGain.gain.value=0;
    inputWorklet.port.onmessage=event=>{
      const frame=event.data instanceof Float32Array ? event.data : new Float32Array(event.data || []);
      sendPcmFrame(frame);
    };
    inputSource.connect(inputWorklet); inputWorklet.connect(silentGain); silentGain.connect(inputContext.destination);
    captureEnabled=true;
    emit('sexta:mic-settings',{settings:{...settings,audioContextSampleRate:inputContext.sampleRate},capabilities:track?.getCapabilities?.() || {},capturedAt:Date.now()});
    reportMetric('capture_ready',{
      trackSampleRate:Number(settings.sampleRate||0)||null,
      trackSampleSize:Number(settings.sampleSize||0)||null,
      trackChannelCount:Number(settings.channelCount||0)||null,
      trackLatencyMs:Number.isFinite(Number(settings.latency))?Math.round(Number(settings.latency)*1000):null,
      echoCancellation:settings.echoCancellation===true,
      noiseSuppression:settings.noiseSuppression===true,
      autoGainControl:settings.autoGainControl===true,
      audioSource:`ctx-${inputContext.sampleRate}-to-${INPUT_RATE}`
    });
    transition('listening');
  }

  function stopMicrophone() {
    captureEnabled=false;
    try{if(inputWorklet?.port)inputWorklet.port.onmessage=null;}catch{}
    try{inputWorklet?.disconnect();}catch{} try{inputSource?.disconnect();}catch{} try{silentGain?.disconnect();}catch{}
    for(const track of mediaStream?.getTracks?.()||[])track.stop();
    try{inputContext?.close();}catch{}
    mediaStream=inputContext=inputSource=inputWorklet=silentGain=resampler=null; localVoiceActive=false;
  }

  async function buildSystemInstruction() {
    const conversationId=localStorage.getItem('sexta_conversation')||'main'; let sync={};
    try{sync=await api(`/api/sync?conversationId=${encodeURIComponent(conversationId)}&fresh=1`);}catch{}
    const settings=sync.settings||{};
    const memories=(sync.memories||[]).slice(0,10).map(x=>`- ${x.content}`).join('\n');
    const recent=(sync.messages||[]).slice(-12).map(x=>`${x.role==='assistant'?'SEXTA':'USUÁRIO'}: ${x.content}`).join('\n');
    const platformRule=IS_ANDROID?'DISPOSITIVO ATUAL: Android. Use android_ para ações no aparelho; Codex pode ser delegado por pc_codex_task.'
      :IS_DESKTOP?'DISPOSITIVO ATUAL: PC. Use pc_ para ações no computador.':'DISPOSITIVO ATUAL: navegador. Escolha o dispositivo pela capacidade e pelo pedido.';
    return [
      'Você é SEXTA-feira, assistente pessoal de voz. Converse em português brasileiro natural, curta e diretamente.',
      'A sessão é contínua: depois de iniciada, o usuário não precisa repetir “Sexta-feira”.',
      'Responda assim que uma pergunta ou intenção estiver clara. Respeite hesitações reais, mas não espere indefinidamente.',
      'Se o usuário falar por cima de você, ceda a vez imediatamente.',
      'Não narre estados internos. Ferramentas rápidas podem executar silenciosamente; tarefas longas podem seguir em segundo plano.',
      'Nunca diga que uma ação terminou antes da ferramenta confirmar.', platformRule,
      `Ajustes: humor ${settings.humor??68}/100, sarcasmo ${settings.sarcasm??42}/100, proatividade ${settings.proactivity??55}/100, verbosidade ${settings.verbosity??32}/100.`,
      memories?`Memórias relevantes:\n${memories}`:'', recent?`Contexto recente:\n${recent}`:''
    ].filter(Boolean).join('\n\n');
  }

  async function persistTurn(userText,assistantText) {
    const u=String(userText||'').replace(/\s+/g,' ').trim(), a=String(assistantText||'').replace(/\s+/g,' ').trim();
    if(!u&&!a)return;
    try{await api('/api/live-turn',{method:'POST',body:JSON.stringify({conversationId:localStorage.getItem('sexta_conversation')||'main',deviceId:localStorage.getItem('sexta_device_id')||'voice-v6',userText:u,assistantText:a})});}catch{}
  }

  async function executeLiveTool(call) {
    const name=String(call?.name||'').trim(), args=call?.args&&typeof call.args==='object'?call.args:{};
    const deviceId=localStorage.getItem('sexta_device_id')||(IS_ANDROID?'android-native':'voice-v6');
    if(!name)return{ok:false,handled:true,state:'failed',error:'TOOL_NAME_MISSING'};
    const plugin=window.Capacitor?.Plugins?.LiveToolBridge||null;
    if(IS_ANDROID&&name.startsWith('android_')&&plugin?.execute){
      const planned=await api('/api/tool-execute',{method:'POST',body:JSON.stringify({name,args,deviceId,preferLocalAndroid:true,origin:ORIGIN})});
      if(planned?.clientAction?.action){const result=await plugin.execute({action:planned.clientAction.action,payload:planned.clientAction.payload||{}});return{...result,tool:name,scope:'android-local',state:result?.ok===false?'failed':'completed'};}
      return planned;
    }
    return api('/api/tool-execute',{method:'POST',body:JSON.stringify({name,args,deviceId,preferLocalAndroid:false,origin:ORIGIN})});
  }

  function sendToolResponses(responses){if(responses?.length&&websocket?.readyState===WebSocket.OPEN&&setupComplete&&sessionActive)websocket.send(JSON.stringify({toolResponse:{functionResponses:responses}}));}

  async function handleToolCall(toolCall){
    const calls=Array.isArray(toolCall?.functionCalls)?toolCall.functionCalls:[]; if(!calls.length||!sessionActive)return;
    pendingToolCalls+=calls.length; lastModelActivityAt=performance.now(); transition('tool');
    const responses=await Promise.all(calls.map(async call=>{try{const result=await executeLiveTool(call);return{id:call.id,name:call.name,response:result??{ok:true,state:'completed'},...(currentSession?.supportsNonBlocking?{scheduling:QUICK_SILENT_TOOLS.has(call.name)?'SILENT':'WHEN_IDLE'}:{})};}catch(error){return{id:call.id,name:call.name,response:{ok:false,handled:true,state:'failed',error:String(error?.message||error||'TOOL_FAILED').slice(0,700)},...(currentSession?.supportsNonBlocking?{scheduling:'WHEN_IDLE'}:{})};}finally{pendingToolCalls=Math.max(0,pendingToolCalls-1);}}));
    sendToolResponses(responses); if(!assistantSpeaking&&pendingToolCalls===0)transition('listening');
  }

  function markModelActivity(){const now=performance.now();lastModelActivityAt=now;if(!turn.firstModelAt)turn.firstModelAt=now;hardRecoveryStarted=false;}

  function finalizeTurnSoon(){
    if(finalizeTimer)clearTimeout(finalizeTimer);
    finalizeTimer=setTimeout(()=>{
      finalizeTimer=null; const snapshot={...turn}; turn=freshTurn(); rescueSent=false; rescueText=''; waitingForInput=false; hardRecoveryStarted=false; emitTranscript();
      if(snapshot.finalInput||snapshot.outputText)void persistTurn(snapshot.finalInput,snapshot.outputText);
      reportMetric('turn',{
        speechStartToInterimMs:snapshot.firstInterimAt&&snapshot.localSpeechStartAt?Math.round(snapshot.firstInterimAt-snapshot.localSpeechStartAt):null,
        speechStartToFinalMs:snapshot.firstFinalAt&&snapshot.localSpeechStartAt?Math.round(snapshot.firstFinalAt-snapshot.localSpeechStartAt):null,
        speechStartToSpeakingMs:snapshot.firstAudioAt&&snapshot.localSpeechStartAt?Math.round(snapshot.firstAudioAt-snapshot.localSpeechStartAt):null,
        hybridFinalized:snapshot.hybridFinalized
      });
      if(!assistantSpeaking&&pendingToolCalls===0&&sessionActive)transition('listening');
    },TURN_SETTLE_MS);
  }

  function rescueTurn(){
    if(!sessionActive||!setupComplete||rescueSent||assistantSpeaking||pendingToolCalls>0||localVoiceActive)return false;
    const text=String(turn.finalInput||turn.interimInput||'').trim(); if(text.length<2)return false;
    rescueSent=true;rescueText=text;transition('thinking',{label:'Recuperando a resposta...'});
    const ok=sendRealtime({text:`O usuário acabou de dizer: ${text}\nResponda diretamente agora sem mencionar esta nota.`});
    if(ok)reportMetric('text_rescue',{chars:text.length});return ok;
  }

  function scheduleReconnect(reason='reconnect'){
    if(!sessionActive||reconnectTimer)return;setupComplete=false;transition('recovering');
    const delay=reconnectRequested?120:Math.min(3500,300*(2**Math.min(reconnectAttempts,4)));reconnectAttempts+=1;
    reconnectTimer=setTimeout(()=>{reconnectTimer=null;void connectLive(reason);},delay);
  }

  async function handleServerMessage(event,socket){
    if(socket!==websocket&&socket!==connectingSocket)return;let raw=event.data;if(raw instanceof Blob)raw=await raw.text();if(raw instanceof ArrayBuffer)raw=new TextDecoder().decode(raw);
    let message;try{message=JSON.parse(raw);}catch{return;}lastServerAt=performance.now();
    if(message.setupComplete){setupComplete=true;reconnectAttempts=0;reconnectRequested=false;if(handshakeTimer)clearTimeout(handshakeTimer);handshakeTimer=null;try{await startMicrophone();}catch(error){console.error('[SEXTA v6] mic',error);transition('error',{label:'Não consegui abrir o microfone.'});}if(rescueText){const pending=rescueText;rescueText='';setTimeout(()=>{if(sessionActive&&setupComplete)sendRealtime({text:`O usuário disse: ${pending}\nResponda diretamente.`});},160);}return;}
    if(message.sessionResumptionUpdate){const u=message.sessionResumptionUpdate;if(u.resumable&&u.newHandle)resumptionHandle=String(u.newHandle);return;}
    if(message.goAway){reconnectRequested=true;try{socket.close(1000,'goaway');}catch{}return;}
    if(message.toolCall){markModelActivity();void handleToolCall(message.toolCall);}
    const content=message.serverContent;if(!content)return;
    if(content.interimInputTranscription?.text){const text=String(content.interimInputTranscription.text).trim();if(text){turn.interimInput=text;if(!turn.firstInterimAt)turn.firstInterimAt=performance.now();emitTranscript();}}
    if(content.inputTranscription?.text){const text=String(content.inputTranscription.text).trim();if(text){turn.finalInput=mergeTranscript(turn.finalInput,text);turn.interimInput='';if(!turn.firstFinalAt)turn.firstFinalAt=performance.now();emitTranscript();if(isVoiceOffCommand(turn.finalInput)){stopVoice();return;}if(!assistantSpeaking&&!localVoiceActive)transition('thinking');}}
    if(content.waitingForInput){waitingForInput=true;assistantSpeaking=false;if(!localVoiceActive)transition('listening',{label:'Ouvindo — pode continuar.'});}
    if(content.interrupted){stopOutput();waitingForInput=false;transition(localVoiceActive?'user_speaking':'listening');}
    if(content.outputTranscription?.text){markModelActivity();turn.outputText=mergeTranscript(turn.outputText,content.outputTranscription.text);}
    for(const part of content.modelTurn?.parts||[]){if(!part?.inlineData?.data||!sessionActive)continue;markModelActivity();if(!turn.firstAudioAt)turn.firstAudioAt=performance.now();waitingForInput=false;assistantSpeaking=true;transition('speaking');await scheduleOutput(part.inlineData.data,part.inlineData.mimeType||'audio/pcm;rate=24000');}
    if(content.turnComplete)finalizeTurnSoon();
  }

  async function connectLive(reason='initial'){
    if(!sessionActive||connectingSocket||(websocket?.readyState===WebSocket.OPEN&&setupComplete))return;transition(reason==='initial'?'connecting':'recovering');
    try{
      if(!cachedInstruction)cachedInstruction=await buildSystemInstruction();if(!sessionActive)return;
      const session=await api('/api/live-token',{method:'POST',body:JSON.stringify({systemInstruction:cachedInstruction,origin:ORIGIN,resumptionHandle:resumptionHandle||''})});
      if(!session?.token)throw new Error('token Live vazio');currentSession=session;
      const socket=new WebSocket(`${WS_BASE}?access_token=${encodeURIComponent(session.token)}`);connectingSocket=socket;
      socket.onopen=()=>{if(!sessionActive){try{socket.close(1000,'off');}catch{}return;}websocket=socket;connectingSocket=null;socket.send(JSON.stringify({setup:{model:`models/${session.model}`,generationConfig:{responseModalities:['AUDIO'],thinkingConfig:{thinkingBudget:Number(session.thinkingBudget??0)},speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:session.voice}}}},realtimeInputConfig:session.realtimeInputConfig,tools:session.tools||[],inputAudioTranscription:session.inputAudioTranscription||{},outputAudioTranscription:session.outputAudioTranscription||{},contextWindowCompression:session.contextWindowCompression||{slidingWindow:{}},sessionResumption:session.sessionResumption||{}}}));if(handshakeTimer)clearTimeout(handshakeTimer);handshakeTimer=setTimeout(()=>{if(sessionActive&&socket===websocket&&!setupComplete){try{socket.close(4000,'handshake-timeout');}catch{}}},10000);};
      socket.onmessage=e=>{void handleServerMessage(e,socket);};socket.onerror=e=>console.warn('[SEXTA v6] websocket',e);socket.onclose=e=>{if(connectingSocket===socket)connectingSocket=null;if(websocket===socket)websocket=null;setupComplete=false;if(handshakeTimer)clearTimeout(handshakeTimer);handshakeTimer=null;stopOutput();if(!sessionActive)return;if(resumptionHandle&&Number(e?.code||0)>=4000)resumptionHandle='';scheduleReconnect(reconnectRequested?'goaway':'socket-close');};
    }catch(error){connectingSocket=null;console.error('[SEXTA v6] conexão',error);if(sessionActive)scheduleReconnect('connect-error');}
  }

  function cleanup(closeSocket=true){
    for(const timer of [reconnectTimer,handshakeTimer,finalizeTimer,hybridTimer])if(timer)clearTimeout(timer);
    reconnectTimer=handshakeTimer=finalizeTimer=hybridTimer=null;setupComplete=false;pendingToolCalls=0;waitingForInput=false;reconnectAttempts=0;reconnectRequested=false;cachedInstruction='';currentSession=null;rescueText='';rescueSent=false;hardRecoveryStarted=false;stopMicrophone();stopOutput();
    if(closeSocket){try{connectingSocket?.close(1000,'voice-off');}catch{}try{websocket?.close(1000,'voice-off');}catch{}}connectingSocket=websocket=null;turn=freshTurn();emitTranscript();
  }

  async function startVoice(){if(sessionActive)return;if(!AudioContextCtor||!window.AudioWorkletNode){transition('error',{label:'Este navegador não suporta áudio em tempo real.'});return;}sessionActive=true;turn=freshTurn();lastModelActivityAt=performance.now();lastServerAt=performance.now();transition('connecting');await connectLive('initial');}
  function stopVoice(){if(!sessionActive)return;sessionActive=false;cleanup(true);transition('off');}
  function toggleVoice(){if(sessionActive)stopVoice();else void startVoice();}

  setInterval(()=>{
    if(!sessionActive||!setupComplete||assistantSpeaking||pendingToolCalls>0||localVoiceActive)return;
    const text=String(turn.finalInput||turn.interimInput||'').trim();if(text.length<2)return;
    const now=performance.now();const quietMs=now-(localVoiceEndedAt||localLastVoiceAt||now);const modelIdle=now-(lastModelActivityAt||turn.firstInterimAt||now);
    if(!rescueSent&&quietMs>=RESCUE_MS&&modelIdle>=RESCUE_MS){rescueTurn();return;}
    if(rescueSent&&!hardRecoveryStarted&&quietMs>=HARD_RECOVERY_MS&&modelIdle>=HARD_RECOVERY_MS){hardRecoveryStarted=true;rescueText=text;transition('recovering');try{websocket?.close(4001,'stalled-turn');}catch{}}
  },200);

  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&sessionActive){if(inputContext?.state==='suspended')void inputContext.resume().catch(()=>{});if(outputContext?.state==='suspended')void outputContext.resume().catch(()=>{});}});
  voiceBtn.onclick=toggleVoice;if(wakeBtn)wakeBtn.onclick=toggleVoice;transition('off');
  window.__sextaGeminiLive={start:startVoice,stop:stopVoice,toggle:toggleVoice,active:()=>sessionActive,debug:()=>({version:'voice-core-v6',platform:ORIGIN,state,sessionActive,setupComplete,captureEnabled,assistantSpeaking,pendingToolCalls,localVoiceActive,waitingForInput,interimTranscript:turn.interimInput,finalTranscript:turn.finalInput,outputTranscript:turn.outputText,rescueSent,resumptionReady:Boolean(resumptionHandle),noiseFloor,lastServerAt,lastModelActivityAt,inputSampleRate:inputContext?.sampleRate||null})};
})();
