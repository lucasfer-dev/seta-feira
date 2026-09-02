import { StreamingSincResampler } from '../public/audio-resampler.js';

function tone(rate, hz, seconds = 1) {
  const out = new Float32Array(Math.floor(rate * seconds));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin(2 * Math.PI * hz * i / rate);
  return out;
}

function amplitude(samples, rate, hz, trim = 200) {
  const start = Math.min(trim, Math.floor(samples.length / 10));
  const end = Math.max(start + 1, samples.length - start);
  let re = 0;
  let im = 0;
  let n = 0;
  for (let i = start; i < end; i += 1, n += 1) {
    const phase = 2 * Math.PI * hz * n / rate;
    re += samples[i] * Math.cos(phase);
    im -= samples[i] * Math.sin(phase);
  }
  return 2 * Math.hypot(re, im) / n;
}

function streamResample(input, sourceRate, chunkMs = 40) {
  const resampler = new StreamingSincResampler(sourceRate, 16000);
  const chunkSize = Math.max(1, Math.round(sourceRate * chunkMs / 1000));
  const parts = [];
  let total = 0;
  for (let i = 0; i < input.length; i += chunkSize) {
    const part = resampler.process(input.subarray(i, i + chunkSize));
    parts.push(part);
    total += part.length;
  }
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

for (const sourceRate of [48000, 44100, 32000]) {
  const passband = streamResample(tone(sourceRate, 2500), sourceRate);
  const passAmp = amplitude(passband, 16000, 2500);
  if (passAmp < 0.9) throw new Error(`Passband degraded at ${sourceRate}: ${passAmp}`);

  const stopband = streamResample(tone(sourceRate, 11000), sourceRate);
  const aliasAmp = amplitude(stopband, 16000, 5000);
  if (aliasAmp > 0.03) throw new Error(`Aliasing too high at ${sourceRate}: ${aliasAmp}`);

  if (Math.abs(passband.length - 16000) > 32) {
    throw new Error(`Unexpected output length at ${sourceRate}: ${passband.length}`);
  }

  console.log(sourceRate, { passAmp, aliasAmp, samples: passband.length });
}
