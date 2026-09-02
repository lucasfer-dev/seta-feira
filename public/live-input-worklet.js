class SextaMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Gemini Live recommends ~100 ms PCM chunks for live transcription.
    // With the browser input context tuned to 16 kHz this produces ~1600 samples.
    this.frameSamples = Math.max(512, Math.round(sampleRate * 0.10));
    this.buffer = new Float32Array(this.frameSamples * 2);
    this.write = 0;
  }

  process(inputs) {
    const input = inputs?.[0]?.[0];
    if (!input?.length) return true;

    let offset = 0;
    while (offset < input.length) {
      const space = this.buffer.length - this.write;
      const take = Math.min(space, input.length - offset);
      this.buffer.set(input.subarray(offset, offset + take), this.write);
      this.write += take;
      offset += take;

      while (this.write >= this.frameSamples) {
        const frame = this.buffer.slice(0, this.frameSamples);
        this.port.postMessage(frame, [frame.buffer]);
        const remaining = this.write - this.frameSamples;
        if (remaining > 0) this.buffer.copyWithin(0, this.frameSamples, this.write);
        this.write = remaining;
      }
    }

    return true;
  }
}

registerProcessor('sexta-mic-processor', SextaMicProcessor);
