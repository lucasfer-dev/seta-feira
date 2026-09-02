(() => {
  if (!navigator.mediaDevices?.getUserMedia) return;

  // Preserve the real browser constructor for Voice Core v6. Do not globally force
  // a custom sample rate: Firefox can reject MediaStream -> AudioContext connections
  // when the device and context rates differ. V6 resamples after capture instead.
  if (!window.__sextaNativeAudioContext) {
    window.__sextaNativeAudioContext = window.AudioContext || window.webkitAudioContext || null;
  }

  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  if (navigator.mediaDevices.__sextaTuned) return;
  navigator.mediaDevices.__sextaTuned = true;

  navigator.mediaDevices.getUserMedia = async constraints => {
    const requested = constraints || {};
    const audio = requested.audio && typeof requested.audio === 'object' ? requested.audio : {};
    const tuned = requested.audio === false ? requested : {
      ...requested,
      audio: {
        ...audio,
        channelCount: audio.channelCount ?? { ideal: 1 },
        echoCancellation: audio.echoCancellation ?? true,
        noiseSuppression: audio.noiseSuppression ?? true,
        autoGainControl: audio.autoGainControl ?? true,
        latency: audio.latency ?? { ideal: 0.01 }
      }
    };

    const stream = await nativeGetUserMedia(tuned);
    const track = stream.getAudioTracks?.()[0];
    const settings = track?.getSettings?.() || {};
    const capabilities = track?.getCapabilities?.() || {};
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    window.__sextaMicSettings = { settings, capabilities, supported, capturedAt: Date.now() };
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
})();
