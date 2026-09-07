class SextaOutputRingBufferProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const cfg = options.processorOptions || {};
    const rate = Number(sampleRate) || 24000;
    const clampMs = (value, fallback, min, max) => Math.max(min, Math.min(max, Number(value) || fallback));

    this.rate = rate;
    this.baseTargetMs = clampMs(cfg.targetMs, 160, 80, 320);
    this.maxTargetMs = clampMs(cfg.maxTargetMs, 280, this.baseTargetMs, 420);
    this.stepMs = clampMs(cfg.stepMs, 35, 10, 80);
    this.targetMs = this.baseTargetMs;
    this.targetFrames = this.framesForMs(this.targetMs);

    this.queue = [];
    this.queuedFrames = 0;
    this.playing = false;
    this.starvedFrame = null;
    this.renderedFrames = 0;
    this.underruns = 0;
    this.rebuffers = 0;
    this.fadeInRemaining = 0;
    this.lastStatsFrame = 0;

    this.port.onmessage = event => this.handleMessage(event.data || {});
    this.port.postMessage({ type: 'ready', sampleRate: this.rate, targetMs: this.targetMs });
  }

  framesForMs(ms) {
    return Math.max(1, Math.round(this.rate * Number(ms || 0) / 1000));
  }

  queueMs() {
    return Math.round(this.queuedFrames / this.rate * 1000);
  }

  updateTarget(ms) {
    this.targetMs = Math.max(this.baseTargetMs, Math.min(this.maxTargetMs, Number(ms) || this.baseTargetMs));
    this.targetFrames = this.framesForMs(this.targetMs);
  }

  handleMessage(message) {
    if (message.type === 'push') {
      const samples = message.samples instanceof Float32Array
        ? message.samples
        : new Float32Array(message.samples || []);
      if (!samples.length) {
        if (message.id != null) this.port.postMessage({ type: 'chunk_end', id: message.id, empty: true });
        return;
      }

      if (this.starvedFrame != null) {
        const gapFrames = Math.max(0, this.renderedFrames - this.starvedFrame);
        const gapMs = Math.round(gapFrames / this.rate * 1000);
        if (gapMs <= 700) {
          this.underruns += 1;
          this.rebuffers += 1;
          this.updateTarget(Math.min(this.maxTargetMs, this.targetMs + this.stepMs));
          this.port.postMessage({
            type: 'underrun',
            gapMs,
            underruns: this.underruns,
            targetMs: Math.round(this.targetMs)
          });
        } else {
          // A long silence is almost certainly the boundary between two user turns,
          // not network jitter. Slowly recover latency toward the base target.
          this.updateTarget(Math.max(this.baseTargetMs, this.targetMs - this.stepMs));
        }
        this.starvedFrame = null;
      }

      this.queue.push({ id: message.id, samples, offset: 0 });
      this.queuedFrames += samples.length;
      return;
    }

    if (message.type === 'drop') {
      const id = message.id;
      const kept = [];
      let removed = false;
      for (const segment of this.queue) {
        if (segment.id === id) {
          this.queuedFrames -= Math.max(0, segment.samples.length - segment.offset);
          removed = true;
        } else kept.push(segment);
      }
      this.queue = kept;
      if (removed && id != null) this.port.postMessage({ type: 'chunk_end', id, cancelled: true });
      if (!this.queue.length) {
        this.playing = false;
        this.starvedFrame = null;
      }
      return;
    }

    if (message.type === 'clear') {
      for (const segment of this.queue) {
        if (segment.id != null) this.port.postMessage({ type: 'chunk_end', id: segment.id, cancelled: true });
      }
      this.queue = [];
      this.queuedFrames = 0;
      this.playing = false;
      this.starvedFrame = null;
      this.fadeInRemaining = 0;
      return;
    }

    if (message.type === 'reset_adaptive_buffer') {
      this.updateTarget(this.baseTargetMs);
      return;
    }
  }

  maybeStart() {
    if (this.playing || this.queuedFrames < this.targetFrames) return;
    this.playing = true;
    this.fadeInRemaining = Math.min(64, this.queuedFrames);
    this.port.postMessage({ type: 'playing', queueMs: this.queueMs(), targetMs: Math.round(this.targetMs) });
  }

  applyFadeIn(output, start, count) {
    if (!this.fadeInRemaining || count <= 0) return;
    const total = Math.min(this.fadeInRemaining, count);
    for (let i = 0; i < total; i += 1) {
      const gain = 1 - (this.fadeInRemaining - i) / 64;
      output[start + i] *= Math.max(0, Math.min(1, gain));
    }
    this.fadeInRemaining = Math.max(0, this.fadeInRemaining - total);
  }

  fadeOutTail(output, written) {
    const count = Math.min(64, written);
    if (!count) return;
    const start = written - count;
    for (let i = 0; i < count; i += 1) {
      output[start + i] *= 1 - ((i + 1) / count);
    }
  }

  process(_inputs, outputs) {
    const output = outputs?.[0]?.[0];
    if (!output) return true;
    output.fill(0);

    this.maybeStart();
    if (!this.playing) {
      this.renderedFrames += output.length;
      this.maybeReportStats();
      return true;
    }

    let written = 0;
    while (written < output.length && this.queue.length) {
      const segment = this.queue[0];
      const available = segment.samples.length - segment.offset;
      const take = Math.min(available, output.length - written);
      output.set(segment.samples.subarray(segment.offset, segment.offset + take), written);
      this.applyFadeIn(output, written, take);
      segment.offset += take;
      this.queuedFrames -= take;
      written += take;

      if (segment.offset >= segment.samples.length) {
        this.queue.shift();
        if (segment.id != null) this.port.postMessage({ type: 'chunk_end', id: segment.id });
      }
    }

    if (written < output.length) {
      // Do not crackle on starvation. Fade to silence and wait for a healthy amount
      // of audio before resuming. If another chunk arrives quickly this is counted
      // as a real underrun; long gaps are treated as normal turn boundaries.
      this.fadeOutTail(output, written);
      this.playing = false;
      if (this.starvedFrame == null) this.starvedFrame = this.renderedFrames + written;
      this.port.postMessage({ type: 'starved', queueMs: this.queueMs(), targetMs: Math.round(this.targetMs) });
    }

    this.renderedFrames += output.length;
    this.maybeReportStats();
    return true;
  }

  maybeReportStats() {
    if (this.renderedFrames - this.lastStatsFrame < this.rate / 4) return;
    this.lastStatsFrame = this.renderedFrames;
    this.port.postMessage({
      type: 'stats',
      queueMs: this.queueMs(),
      targetMs: Math.round(this.targetMs),
      playing: this.playing,
      underruns: this.underruns,
      rebuffers: this.rebuffers
    });
  }
}

registerProcessor('sexta-output-ring-buffer', SextaOutputRingBufferProcessor);
