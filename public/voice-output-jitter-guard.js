(() => {
  if (window.__sextaOutputJitterGuard?.installed) return;

  const OriginalAudioContext = window.__sextaNativeAudioContext || window.AudioContext || window.webkitAudioContext;
  if (typeof OriginalAudioContext !== 'function') return;

  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const IS_FIREFOX = /Firefox/i.test(navigator.userAgent);
  const IS_DESKTOP = /Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop);
  const OUTPUT_RATE = 24000;
  const LEGACY_EXTRA_BUFFER_SECONDS = IS_ANDROID ? 0.035 : IS_DESKTOP ? 0.11 : 0.085;
  // Legacy CI marker kept during the staged rollout: 2.1.0-firefox-headroom.
  // Desktop Electron mostrou gaps reais acima de 500 ms em produção. Um alvo de
  // 300 ms não consegue mascarar isso; o perfil dedicado começa com mais folga e
  // cresce adaptativamente, preservando Android e Firefox com seus perfis próprios.
  const RING_TARGET_MS = IS_ANDROID ? 150 : IS_FIREFOX ? 620 : IS_DESKTOP ? 480 : 300;
  const RING_MAX_TARGET_MS = IS_ANDROID ? 320 : IS_FIREFOX ? 950 : IS_DESKTOP ? 900 : 600;
  const RING_STEP_MS = IS_ANDROID ? 40 : IS_FIREFOX ? 110 : IS_DESKTOP ? 100 : 70;

  let outputContexts = 0;
  let workletContexts = 0;
  let workletFailures = 0;
  let scheduledChunks = 0;
  let detectedUnderruns = 0;
  let lastGapMs = 0;
  let lastQueuedMs = 0;
  let adaptiveTargetMs = RING_TARGET_MS;
  let lastMode = 'initializing';

  function authHeaders() {
    const token = localStorage.getItem('sexta_token') || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function platformName() {
    if (IS_ANDROID) return 'android';
    if (IS_DESKTOP) return 'desktop';
    return 'browser';
  }

  function reportUnderrun(gapMs, targetMs) {
    void fetch('/api/live-metrics', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        kind: 'voice_core_v10:output_underrun',
        platform: platformName(),
        phase: 'playback-ring-buffer',
        outputUnderruns: detectedUnderruns,
        prebufferMs: Math.round(targetMs || adaptiveTargetMs || RING_TARGET_MS),
        gapMs,
        outputQueueMs: lastQueuedMs,
        outputBufferTargetMs: Math.round(targetMs || adaptiveTargetMs || RING_TARGET_MS),
        outputMode: 'audio-worklet-ring',
        clientTimestamp: new Date().toISOString()
      })
    }).catch(() => {});
  }

  function wrapOutputContext(context) {
    outputContexts += 1;
    const nativeCreateBufferSource = context.createBufferSource.bind(context);
    const contextId = outputContexts;
    let sequence = 0;
    let workletNode = null;
    let workletReady = false;
    const canUseWorklet = Boolean(context.audioWorklet && typeof window.AudioWorkletNode === 'function');
    let workletFailed = !canUseWorklet;
    const pendingStarts = [];
    const finishers = new Map();

    if (!canUseWorklet) lastMode = 'legacy-buffer-source';

    const finishById = (id, detail = {}) => {
      const finish = finishers.get(id);
      if (!finish) return;
      finishers.delete(id);
      finish(detail);
    };

    const flushPending = () => {
      const items = pendingStarts.splice(0);
      for (const item of items) {
        if (workletReady) item.pushToWorklet();
        else item.startLegacy();
      }
    };

    const readyPromise = canUseWorklet
      ? (async () => {
          await context.audioWorklet.addModule('/live-output-worklet.js');
          workletNode = new window.AudioWorkletNode(context, 'sexta-output-ring-buffer', {
            numberOfInputs: 0,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
              targetMs: RING_TARGET_MS,
              maxTargetMs: RING_MAX_TARGET_MS,
              stepMs: RING_STEP_MS
            }
          });
          workletNode.connect(context.destination);
          workletNode.port.onmessage = event => {
            const message = event.data || {};
            if (message.type === 'ready') {
              adaptiveTargetMs = Number(message.targetMs || RING_TARGET_MS);
              lastMode = 'audio-worklet-ring';
              return;
            }
            if (message.type === 'chunk_end') {
              finishById(message.id, message);
              return;
            }
            if (message.type === 'underrun') {
              detectedUnderruns = Math.max(detectedUnderruns + 1, Number(message.underruns || 0));
              lastGapMs = Math.max(0, Math.round(Number(message.gapMs || 0)));
              adaptiveTargetMs = Math.round(Number(message.targetMs || adaptiveTargetMs || RING_TARGET_MS));
              reportUnderrun(lastGapMs, adaptiveTargetMs);
              return;
            }
            if (message.type === 'stats' || message.type === 'playing' || message.type === 'starved') {
              if (Number.isFinite(Number(message.queueMs))) lastQueuedMs = Math.max(0, Math.round(Number(message.queueMs)));
              if (Number.isFinite(Number(message.targetMs))) adaptiveTargetMs = Math.max(RING_TARGET_MS, Math.round(Number(message.targetMs)));
            }
          };
          workletReady = true;
          workletContexts += 1;
          lastMode = 'audio-worklet-ring';
          flushPending();
        })().catch(error => {
          workletFailed = true;
          workletFailures += 1;
          lastMode = 'legacy-buffer-source';
          console.warn('[SEXTA Output] AudioWorklet falhou; usando scheduler legado.', error);
          flushPending();
        })
      : Promise.resolve();

    function makeVirtualSource() {
      const id = `ctx${contextId}-chunk${++sequence}`;
      let buffer = null;
      let destination = context.destination;
      let onended = null;
      let started = false;
      let stopped = false;
      let ended = false;
      let legacySource = null;

      const finish = () => {
        if (ended) return;
        ended = true;
        queueMicrotask(() => {
          try { onended?.(); } catch {}
        });
      };

      const source = {
        get buffer() { return buffer; },
        set buffer(value) { buffer = value; },
        get onended() { return onended; },
        set onended(value) { onended = typeof value === 'function' ? value : null; },
        connect(nextDestination) {
          destination = nextDestination || context.destination;
          return source;
        },
        disconnect() {
          try { legacySource?.disconnect(); } catch {}
        },
        start(when = 0, ...rest) {
          if (started) return;
          started = true;
          scheduledChunks += 1;
          finishers.set(id, finish);

          const pushToWorklet = () => {
            if (stopped || !workletNode) { finishById(id, { cancelled: true }); return; }
            const channel = buffer?.getChannelData?.(0);
            if (!channel?.length) { finishById(id, { empty: true }); return; }
            const samples = new Float32Array(channel.length);
            samples.set(channel);
            workletNode.port.postMessage({ type: 'push', id, samples }, [samples.buffer]);
          };

          const startLegacy = () => {
            if (stopped) { finishById(id, { cancelled: true }); return; }
            try {
              legacySource = nativeCreateBufferSource();
              legacySource.buffer = buffer;
              legacySource.connect(destination || context.destination);
              legacySource.onended = () => finishById(id);
              const requested = Number(when) || 0;
              const safeWhen = Math.max(context.currentTime + 0.012, requested);
              legacySource.start(safeWhen, ...rest);
            } catch {
              finishById(id, { failed: true });
            }
          };

          if (workletReady) pushToWorklet();
          else if (workletFailed) startLegacy();
          else {
            pendingStarts.push({ pushToWorklet, startLegacy });
            void readyPromise;
          }
        },
        stop(...args) {
          if (stopped) return;
          stopped = true;
          if (workletReady && workletNode) {
            try { workletNode.port.postMessage({ type: 'drop', id }); } catch {}
          }
          try { legacySource?.stop(...args); } catch {}
          finishById(id, { cancelled: true });
        }
      };

      return source;
    }

    return new Proxy(context, {
      get(target, prop) {
        if (prop === 'currentTime') return target.currentTime + LEGACY_EXTRA_BUFFER_SECONDS;
        if (prop === 'createBufferSource') return makeVirtualSource;
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  }

  const GuardedAudioContext = new Proxy(OriginalAudioContext, {
    construct(RealTarget, args) {
      const context = Reflect.construct(RealTarget, args, RealTarget);
      const requestedRate = Number(args?.[0]?.sampleRate || 0);
      if (Math.abs(requestedRate - OUTPUT_RATE) <= 1) return wrapOutputContext(context);
      return context;
    }
  });

  window.__sextaNativeAudioContext = GuardedAudioContext;
  window.__sextaOutputOriginalAudioContext = OriginalAudioContext;

  window.__sextaOutputJitterGuard = {
    installed: true,
    version: '2.2.0-desktop-headroom',
    debug: () => ({
      mode: lastMode,
      extraBufferMs: Math.round(LEGACY_EXTRA_BUFFER_SECONDS * 1000),
      effectiveTargetMs: Math.round(LEGACY_EXTRA_BUFFER_SECONDS * 1000) + (IS_ANDROID ? 90 : IS_DESKTOP ? RING_TARGET_MS : 28),
      baseTargetMs: RING_TARGET_MS,
      adaptiveTargetMs,
      maxTargetMs: RING_MAX_TARGET_MS,
      queuedMs: lastQueuedMs,
      outputContexts,
      workletContexts,
      workletFailures,
      scheduledChunks,
      detectedUnderruns,
      lastGapMs,
      platform: platformName(),
      browser: IS_FIREFOX ? 'firefox' : IS_DESKTOP ? 'electron' : 'other'
    })
  };
})();
