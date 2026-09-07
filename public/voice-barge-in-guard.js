(() => {
  if (window.__sextaBargeInGuard?.installed) return;
  if (typeof window.AudioWorkletNode !== 'function') return;

  const NativeAudioWorkletNode = window.AudioWorkletNode;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const IS_FIREFOX = /Firefox/i.test(navigator.userAgent);

  const BASE_THRESHOLD = IS_ANDROID ? 0.024 : 0.019;
  const NORMAL_CONFIRM_MS = IS_ANDROID ? 240 : 210;
  const FAST_CONFIRM_MS = IS_ANDROID ? 120 : 105;
  const SPEAKING_GRACE_MS = 180;
  const MAX_BUFFER_MS = 360;
  const PASS_THROUGH_MS = 1200;

  const LISTEN_BASE_THRESHOLD = IS_ANDROID ? 0.014 : IS_FIREFOX ? 0.0115 : 0.0105;
  const LISTEN_FLOOR_MULTIPLIER = IS_ANDROID ? 4.5 : IS_FIREFOX ? 4.2 : 3.8;
  const LISTEN_CONFIRM_MS = IS_ANDROID ? 150 : 125;
  const LISTEN_FAST_MS = IS_ANDROID ? 90 : 80;
  const LISTEN_BUFFER_MS = 320;
  const LISTEN_PASS_THROUGH_MS = 1800;

  let assistantSpeaking = false;
  let voiceState = 'off';
  let speakingStartedAt = 0;
  let ambientFloor = 0.0045;
  let candidateMs = 0;
  let candidatePeak = 0;
  let passThroughUntil = 0;
  let rejectedCandidates = 0;
  let acceptedCandidates = 0;

  let listenCandidateMs = 0;
  let listenCandidatePeak = 0;
  let listenPassThroughUntil = 0;
  let listenRejected = 0;
  let listenAccepted = 0;

  function resetCandidate() {
    candidateMs = 0;
    candidatePeak = 0;
    passThroughUntil = 0;
  }

  function resetListenCandidate() {
    listenCandidateMs = 0;
    listenCandidatePeak = 0;
    listenPassThroughUntil = 0;
  }

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function peak(samples) {
    let value = 0;
    for (let i = 0; i < samples.length; i += 1) value = Math.max(value, Math.abs(samples[i]));
    return value;
  }

  function threshold() {
    return Math.max(BASE_THRESHOLD, ambientFloor * (IS_ANDROID ? 5.4 : 4.8));
  }

  function listeningThreshold() {
    return Math.max(LISTEN_BASE_THRESHOLD, ambientFloor * LISTEN_FLOOR_MULTIPLIER);
  }

  function shouldGateIdleSpeech() {
    return !assistantSpeaking && (voiceState === 'listening' || voiceState === 'thinking' || voiceState === 'recovering');
  }

  window.addEventListener('sexta:voice-state', event => {
    const detail = event?.detail || {};
    const nextSpeaking = Boolean(detail.assistantSpeaking || detail.state === 'speaking');
    const nextState = String(detail.state || voiceState);

    if (nextSpeaking && !assistantSpeaking) {
      speakingStartedAt = performance.now();
      resetCandidate();
      resetListenCandidate();
    }
    if (!nextSpeaking && assistantSpeaking) resetCandidate();
    if (nextState === 'user_speaking') {
      listenPassThroughUntil = Number.POSITIVE_INFINITY;
      listenCandidateMs = 0;
      listenCandidatePeak = 0;
    } else if (voiceState === 'user_speaking' && nextState !== 'user_speaking') {
      resetListenCandidate();
    }

    voiceState = nextState;
    assistantSpeaking = nextSpeaking;
  });

  const mediaDevices = navigator.mediaDevices;
  if (mediaDevices?.getUserMedia && !mediaDevices.__sextaGuardedGetUserMedia) {
    const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
    try {
      mediaDevices.getUserMedia = constraints => {
        const next = constraints && typeof constraints === 'object' ? { ...constraints } : constraints;
        if (next?.audio && typeof next.audio === 'object') {
          next.audio = {
            ...next.audio,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false
          };
        }
        return nativeGetUserMedia(next);
      };
      Object.defineProperty(mediaDevices, '__sextaGuardedGetUserMedia', { value: true });
    } catch {}
  }

  function installPortGuard(node, context) {
    const port = node?.port;
    if (!port?.addEventListener) return;

    const sampleRate = Number(context?.sampleRate || 48000) || 48000;
    const replayEvents = new WeakSet();
    let buffered = [];
    let bufferedMs = 0;
    let listenBuffered = [];
    let listenBufferedMs = 0;

    function clearBuffer() {
      buffered = [];
      bufferedMs = 0;
    }

    function clearListenBuffer() {
      listenBuffered = [];
      listenBufferedMs = 0;
    }

    function copyFrame(data) {
      if (data instanceof Float32Array) return data.slice();
      try { return new Float32Array(data || []).slice(); } catch { return new Float32Array(); }
    }

    function remember(target, frame, frameMs, maxMs) {
      target.frames.push(frame);
      target.ms += frameMs;
      while (target.frames.length > 1 && target.ms > maxMs) {
        const removed = target.frames.shift();
        target.ms -= removed.length / sampleRate * 1000;
      }
    }

    function rememberBarge(frame, frameMs) {
      const target = { frames: buffered, ms: bufferedMs };
      remember(target, frame, frameMs, MAX_BUFFER_MS);
      buffered = target.frames;
      bufferedMs = target.ms;
    }

    function rememberListening(frame, frameMs) {
      const target = { frames: listenBuffered, ms: listenBufferedMs };
      remember(target, frame, frameMs, LISTEN_BUFFER_MS);
      listenBuffered = target.frames;
      listenBufferedMs = target.ms;
    }

    function replay(frames) {
      for (const frame of frames) {
        const replay = new MessageEvent('message', { data: frame });
        replayEvents.add(replay);
        port.dispatchEvent(replay);
      }
    }

    function replayBuffered() {
      replay(buffered);
      clearBuffer();
    }

    function replayListenBuffered() {
      replay(listenBuffered);
      clearListenBuffer();
    }

    port.addEventListener('message', event => {
      if (replayEvents.has(event)) return;

      const frame = copyFrame(event?.data);
      if (!frame.length) return;
      const frameMs = frame.length / sampleRate * 1000;
      const level = rms(frame);
      const framePeak = peak(frame);
      const now = performance.now();

      if (!assistantSpeaking && voiceState !== 'user_speaking' && level < 0.028) {
        ambientFloor = ambientFloor * 0.994 + level * 0.006;
      }

      if (shouldGateIdleSpeech()) {
        if (now < listenPassThroughUntil) return;

        event.stopImmediatePropagation();
        rememberListening(frame, frameMs);

        const gate = listeningThreshold();
        const voiced = level >= gate || framePeak >= gate * 2.2;
        if (voiced) {
          listenCandidateMs += frameMs;
          listenCandidatePeak = Math.max(listenCandidatePeak, level, framePeak * 0.45);
        } else {
          const hadCandidate = listenCandidateMs > 0;
          listenCandidateMs = Math.max(0, listenCandidateMs - frameMs * 1.9);
          if (listenCandidateMs === 0) {
            if (hadCandidate) listenRejected += 1;
            listenCandidatePeak = 0;
            clearListenBuffer();
          }
        }

        const fast = listenCandidatePeak >= gate * 1.8 && listenCandidateMs >= LISTEN_FAST_MS;
        const normal = listenCandidatePeak >= gate * 1.12 && listenCandidateMs >= LISTEN_CONFIRM_MS;
        if (fast || normal) {
          listenAccepted += 1;
          listenPassThroughUntil = now + LISTEN_PASS_THROUGH_MS;
          listenCandidateMs = 0;
          listenCandidatePeak = 0;
          replayListenBuffered();
          window.dispatchEvent(new CustomEvent('sexta:listen-gate', {
            detail: { phase: 'accepted', level, threshold: gate, fast, voiceState }
          }));
        }
        return;
      }

      if (!assistantSpeaking) {
        clearBuffer();
        clearListenBuffer();
        return;
      }

      if (now < passThroughUntil) return;

      event.stopImmediatePropagation();
      rememberBarge(frame, frameMs);

      const gate = threshold();
      const voiced = level >= gate;
      const inGrace = now - speakingStartedAt < SPEAKING_GRACE_MS;

      if (voiced) {
        candidateMs += frameMs;
        candidatePeak = Math.max(candidatePeak, level);
      } else {
        const hadCandidate = candidateMs > 0;
        candidateMs = Math.max(0, candidateMs - frameMs * 1.8);
        if (candidateMs === 0) {
          if (hadCandidate) rejectedCandidates += 1;
          candidatePeak = 0;
          clearBuffer();
        }
      }

      const veryStrong = candidatePeak >= gate * (IS_ANDROID ? 1.9 : 1.8);
      const sustainedStrong = candidatePeak >= gate * 1.25;
      const fastConfirmed = veryStrong && candidateMs >= FAST_CONFIRM_MS && !inGrace;
      const normalConfirmed = sustainedStrong && candidateMs >= NORMAL_CONFIRM_MS;

      if (fastConfirmed || normalConfirmed) {
        acceptedCandidates += 1;
        passThroughUntil = now + PASS_THROUGH_MS;
        candidateMs = 0;
        candidatePeak = 0;
        replayBuffered();
        window.dispatchEvent(new CustomEvent('sexta:barge-in-guard', {
          detail: { phase: 'accepted', level, threshold: gate, fast: fastConfirmed }
        }));
      }
    });

    try { port.start?.(); } catch {}
  }

  const GuardedAudioWorkletNode = new Proxy(NativeAudioWorkletNode, {
    construct(Target, args) {
      const node = Reflect.construct(Target, args, Target);
      if (String(args?.[1] || '') === 'sexta-mic-processor') {
        try { installPortGuard(node, args?.[0]); }
        catch (error) { console.warn('[SEXTA] barge-in guard indisponível:', error); }
      }
      return node;
    }
  });

  window.AudioWorkletNode = GuardedAudioWorkletNode;
  window.__sextaBargeInGuard = {
    installed: true,
    version: '1.2.1-listen-thinking-gate',
    debug: () => ({
      assistantSpeaking,
      voiceState,
      ambientFloor,
      threshold: threshold(),
      listeningThreshold: listeningThreshold(),
      candidateMs,
      candidatePeak,
      acceptedCandidates,
      rejectedCandidates,
      listenCandidateMs,
      listenCandidatePeak,
      listenAccepted,
      listenRejected,
      autoGainControlForcedOff: Boolean(mediaDevices?.__sextaGuardedGetUserMedia)
    })
  };
})();
