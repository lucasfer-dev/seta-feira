(() => {
  if (window.__sextaBargeInGuard?.installed) return;
  if (typeof window.AudioWorkletNode !== 'function') return;

  const NativeAudioWorkletNode = window.AudioWorkletNode;
  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const BASE_THRESHOLD = IS_ANDROID ? 0.024 : 0.019;
  const NORMAL_CONFIRM_MS = IS_ANDROID ? 240 : 210;
  const FAST_CONFIRM_MS = IS_ANDROID ? 120 : 105;
  const SPEAKING_GRACE_MS = 180;
  const MAX_BUFFER_MS = 360;
  const PASS_THROUGH_MS = 1200;

  let assistantSpeaking = false;
  let voiceState = 'off';
  let speakingStartedAt = 0;
  let ambientFloor = 0.0045;
  let candidateMs = 0;
  let candidatePeak = 0;
  let passThroughUntil = 0;
  let rejectedCandidates = 0;
  let acceptedCandidates = 0;

  function resetCandidate() {
    candidateMs = 0;
    candidatePeak = 0;
    passThroughUntil = 0;
  }

  function rms(samples) {
    if (!samples?.length) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  function threshold() {
    return Math.max(BASE_THRESHOLD, ambientFloor * (IS_ANDROID ? 5.4 : 4.8));
  }

  window.addEventListener('sexta:voice-state', event => {
    const detail = event?.detail || {};
    const nextSpeaking = Boolean(detail.assistantSpeaking || detail.state === 'speaking');
    voiceState = String(detail.state || voiceState);
    if (nextSpeaking && !assistantSpeaking) {
      speakingStartedAt = performance.now();
      resetCandidate();
    }
    if (!nextSpeaking && assistantSpeaking) resetCandidate();
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

    function clearBuffer() {
      buffered = [];
      bufferedMs = 0;
    }

    function copyFrame(data) {
      if (data instanceof Float32Array) return data.slice();
      try { return new Float32Array(data || []).slice(); } catch { return new Float32Array(); }
    }

    function remember(frame, frameMs) {
      buffered.push(frame);
      bufferedMs += frameMs;
      while (buffered.length > 1 && bufferedMs > MAX_BUFFER_MS) {
        const removed = buffered.shift();
        bufferedMs -= removed.length / sampleRate * 1000;
      }
    }

    function replayBuffered() {
      for (const frame of buffered) {
        const replay = new MessageEvent('message', { data: frame });
        replayEvents.add(replay);
        port.dispatchEvent(replay);
      }
      clearBuffer();
    }

    port.addEventListener('message', event => {
      if (replayEvents.has(event)) return;

      const frame = copyFrame(event?.data);
      if (!frame.length) return;
      const frameMs = frame.length / sampleRate * 1000;
      const level = rms(frame);
      const now = performance.now();

      if (!assistantSpeaking) {
        clearBuffer();
        if (voiceState === 'listening' && level < 0.03) {
          ambientFloor = ambientFloor * 0.995 + level * 0.005;
        }
        return;
      }

      if (now < passThroughUntil) return;

      event.stopImmediatePropagation();
      remember(frame, frameMs);

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
    version: '1.1.0',
    debug: () => ({
      assistantSpeaking,
      voiceState,
      ambientFloor,
      threshold: threshold(),
      candidateMs,
      candidatePeak,
      acceptedCandidates,
      rejectedCandidates,
      autoGainControlForcedOff: Boolean(mediaDevices?.__sextaGuardedGetUserMedia)
    })
  };
})();
