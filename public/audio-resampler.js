export class StreamingSincResampler {
  constructor(sourceRate, targetRate = 16000, { radius = 16, cutoffScale = 0.92 } = {}) {
    if (!(sourceRate > 0) || !(targetRate > 0)) throw new Error('invalid sample rate');
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.ratio = sourceRate / targetRate;
    this.radius = Math.max(8, Math.min(32, Math.round(radius)));
    this.cutoff = 0.5 * Math.min(1, targetRate / sourceRate) * cutoffScale;
    this.buffer = new Float32Array(0);
    this.baseIndex = 0;
    this.nextPos = 0;
  }

  reset() {
    this.buffer = new Float32Array(0);
    this.baseIndex = 0;
    this.nextPos = 0;
  }

  process(chunk) {
    const input = chunk instanceof Float32Array ? chunk : new Float32Array(chunk || []);
    if (!input.length) return new Float32Array(0);
    if (this.sourceRate === this.targetRate) return input.slice();

    const merged = new Float32Array(this.buffer.length + input.length);
    merged.set(this.buffer, 0);
    merged.set(input, this.buffer.length);
    this.buffer = merged;

    const availableEnd = this.baseIndex + this.buffer.length;
    const estimate = Math.max(32, Math.ceil(input.length / this.ratio) + 16);
    const dynamic = [];

    while (this.nextPos + this.radius < availableEnd) {
      const center = Math.floor(this.nextPos);
      let weighted = 0;
      let weightSum = 0;

      for (let n = center - this.radius + 1; n <= center + this.radius; n += 1) {
        const x = this.nextPos - n;
        if (Math.abs(x) > this.radius) continue;
        const local = n - this.baseIndex;
        const sample = local >= 0 && local < this.buffer.length ? this.buffer[local] : 0;
        const window = 0.5 + 0.5 * Math.cos(Math.PI * x / this.radius);
        const arg = 2 * this.cutoff * x;
        const sinc = Math.abs(arg) < 1e-8 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
        const weight = 2 * this.cutoff * sinc * window;
        weighted += sample * weight;
        weightSum += weight;
      }

      dynamic.push(Math.abs(weightSum) > 1e-10 ? weighted / weightSum : 0);
      this.nextPos += this.ratio;
      if (dynamic.length > estimate * 2) break;
    }

    const discardBefore = Math.max(this.baseIndex, Math.floor(this.nextPos) - this.radius - 2);
    const discard = discardBefore - this.baseIndex;
    if (discard > 0) {
      this.buffer = this.buffer.slice(discard);
      this.baseIndex = discardBefore;
    }

    return Float32Array.from(dynamic);
  }
}
