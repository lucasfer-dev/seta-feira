(() => {
  if (window.__sextaOutputJitterGuard?.installed) return;

  const OriginalAudioContext = window.__sextaNativeAudioContext || window.AudioContext || window.webkitAudioContext;
  if (typeof OriginalAudioContext !== 'function') return;

  const IS_ANDROID = /Android/i.test(navigator.userAgent);
  const OUTPUT_RATE = 24000;
  const EXTRA_BUFFER_SECONDS = IS_ANDROID ? 0.035 : 0.085;
  const UNDERRUN_GAP_SECONDS = 0.018;

  let outputContexts = 0;
  let scheduledChunks = 0;
  let detectedUnderruns = 0;
  let lastGapMs = 0;

  function authHeaders() {
    const token = localStorage.getItem('sexta_token') || '';
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  function reportUnderrun(gapMs) {
    void fetch('/api/live-metrics', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        kind: 'voice_core_v10:output_underrun',
        platform: IS_ANDROID ? 'android' : 'browser',
        phase: 'playback',
        outputUnderruns: detectedUnderruns,
        prebufferMs: Math.round(EXTRA_BUFFER_SECONDS * 1000),
        gapMs
      })
    }).catch(() => {});
  }

  function wrapOutputContext(context) {
    outputContexts += 1;
    const nativeCreateBufferSource = context.createBufferSource.bind(context);
    let lastActualEnd = 0;

    return new Proxy(context, {
      get(target, prop) {
        if (prop === 'currentTime') {
          return Math.max(0, target.currentTime - EXTRA_BUFFER_SECONDS);
        }

        if (prop === 'createBufferSource') {
          return () => {
            const source = nativeCreateBufferSource();
            const nativeStart = source.start.bind(source);
            const nativeStop = source.stop.bind(source);

            return new Proxy(source, {
              get(sourceTarget, sourceProp) {
                if (sourceProp === 'start') {
                  return (when = 0, ...rest) => {
                    const requestedWhen = Number(when) || 0;
                    const actualWhen = requestedWhen > 0
                      ? requestedWhen + EXTRA_BUFFER_SECONDS
                      : requestedWhen;
                    const duration = Number(sourceTarget.buffer?.duration || 0);

                    if (lastActualEnd > 0 && target.currentTime < lastActualEnd + 0.35) {
                      const gap = actualWhen - lastActualEnd;
                      if (gap > UNDERRUN_GAP_SECONDS) {
                        detectedUnderruns += 1;
                        lastGapMs = Math.round(gap * 1000);
                        reportUnderrun(lastGapMs);
                      }
                    } else if (target.currentTime >= lastActualEnd + 0.35) {
                      lastActualEnd = 0;
                    }

                    scheduledChunks += 1;
                    nativeStart(actualWhen, ...rest);
                    lastActualEnd = Math.max(lastActualEnd, actualWhen + duration);
                  };
                }

                if (sourceProp === 'stop') {
                  return (...args) => {
                    try { return nativeStop(...args); }
                    finally {
                      if (target.currentTime >= lastActualEnd - 0.02) lastActualEnd = 0;
                    }
                  };
                }

                const value = Reflect.get(sourceTarget, sourceProp, sourceTarget);
                return typeof value === 'function' ? value.bind(sourceTarget) : value;
              },
              set(sourceTarget, sourceProp, value) {
                return Reflect.set(sourceTarget, sourceProp, value, sourceTarget);
              }
            });
          };
        }

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

  // browser-audio-tuning.js intentionally exposes the constructor used by Voice Core.
  // Patch only that private constructor so unrelated page audio stays untouched.
  window.__sextaNativeAudioContext = GuardedAudioContext;

  window.__sextaOutputJitterGuard = {
    installed: true,
    version: '1.1.0',
    debug: () => ({
      extraBufferMs: Math.round(EXTRA_BUFFER_SECONDS * 1000),
      outputContexts,
      scheduledChunks,
      detectedUnderruns,
      lastGapMs
    })
  };
})();
