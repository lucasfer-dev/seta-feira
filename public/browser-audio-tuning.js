(() => {
  if (!navigator.mediaDevices?.getUserMedia) return;

  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (NativeAudioContext && !window.__sextaNativeAudioContext) {
    window.__sextaNativeAudioContext = NativeAudioContext;

    function SextaAudioContext(options = {}) {
      const config = { ...(options || {}) };
      // Voice Core creates the input context without an explicit sample rate.
      // Let the browser perform its own high-quality device -> 16 kHz conversion
      // instead of resampling every PCM block with our old linear converter.
      if (!config.sampleRate) config.sampleRate = 16000;
      return new NativeAudioContext(config);
    }
    SextaAudioContext.prototype = NativeAudioContext.prototype;
    try { Object.setPrototypeOf(SextaAudioContext, NativeAudioContext); } catch {}
    window.AudioContext = SextaAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = SextaAudioContext;
  }

  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (!navigator.mediaDevices.__sextaTuned) {
    navigator.mediaDevices.__sextaTuned = true;
    navigator.mediaDevices.getUserMedia = async constraints => {
      const requested = constraints || {};
      const audio = requested.audio && typeof requested.audio === 'object' ? requested.audio : {};
      const tuned = requested.audio === false ? requested : {
        ...requested,
        audio: {
          ...audio,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 16000 },
          sampleSize: { ideal: 16 },
          echoCancellation: audio.echoCancellation ?? true,
          noiseSuppression: audio.noiseSuppression ?? true,
          autoGainControl: audio.autoGainControl ?? true
        }
      };

      const stream = await nativeGetUserMedia(tuned);
      const track = stream.getAudioTracks?.()[0];
      const settings = track?.getSettings?.() || {};
      const capabilities = track?.getCapabilities?.() || {};
      window.__sextaMicSettings = { settings, capabilities, capturedAt: Date.now() };
      window.dispatchEvent(new CustomEvent('sexta:mic-settings', { detail: window.__sextaMicSettings }));
      console.info('[SEXTA Mic]', {
        sampleRate: settings.sampleRate,
        sampleSize: settings.sampleSize,
        channelCount: settings.channelCount,
        latency: settings.latency,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl
      });
      return stream;
    };
  }
})();
