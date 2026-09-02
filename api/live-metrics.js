import { isOwner, parseJson, send } from '../lib/core.mjs';

function boundedNumber(value, max = 120000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function shortString(value, max = 80) {
  return String(value || '').slice(0, max);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req).catch(() => ({}));
  const metrics = {
    kind: shortString(body.kind || 'legacy', 32),
    phase: shortString(body.phase || 'complete', 32),
    platform: shortString(body.platform || 'unknown', 24),
    turnId: shortString(body.turnId, 80),

    // Legacy measurements from live-voice-v3/v4.
    speechEndToFirstAudioMs: boundedNumber(body.speechEndToFirstAudioMs),
    speechStartToFirstAudioMs: boundedNumber(body.speechStartToFirstAudioMs),
    firstServerEventMs: boundedNumber(body.firstServerEventMs),
    outputUnderruns: boundedNumber(body.outputUnderruns, 100),
    prebufferMs: boundedNumber(body.prebufferMs, 1000),

    // Pipeline telemetry from live-latency-probe.
    clientEndSilenceConfiguredMs: boundedNumber(body.clientEndSilenceConfiguredMs, 5000),
    speechActivityMs: boundedNumber(body.speechActivityMs),
    endToFirstServerMs: boundedNumber(body.endToFirstServerMs),
    endToInputTranscriptMs: boundedNumber(body.endToInputTranscriptMs),
    inputTranscriptBeforeEnd: Boolean(body.inputTranscriptBeforeEnd),
    endToFirstModelMs: boundedNumber(body.endToFirstModelMs),
    endToFirstAudioMs: boundedNumber(body.endToFirstAudioMs),
    firstServerToAudioMs: boundedNumber(body.firstServerToAudioMs),
    audioReceivedToScheduledMs: boundedNumber(body.audioReceivedToScheduledMs),
    endToPlaybackDueMs: boundedNumber(body.endToPlaybackDueMs),
    endToToolCallMs: boundedNumber(body.endToToolCallMs),
    toolResponseMs: boundedNumber(body.toolResponseMs),
    endToTurnCompleteMs: boundedNumber(body.endToTurnCompleteMs),
    toolCalls: boundedNumber(body.toolCalls, 100),
    audioChunks: boundedNumber(body.audioChunks, 10000),

    // Native Android full-duplex telemetry.
    nativeFullDuplex: Boolean(body.nativeFullDuplex),
    audioSource: shortString(body.audioSource, 40),
    aecAvailable: Boolean(body.aecAvailable),
    aecEnabled: Boolean(body.aecEnabled),
    noiseSuppressorAvailable: Boolean(body.noiseSuppressorAvailable),
    noiseSuppressorEnabled: Boolean(body.noiseSuppressorEnabled),
    agcAvailable: Boolean(body.agcAvailable),
    agcEnabled: Boolean(body.agcEnabled),
    interruptToSilenceMs: boundedNumber(body.interruptToSilenceMs, 10000),
    bargeInRms: boundedNumber(body.bargeInRms, 32768)
  };

  const mainLatency = metrics.endToPlaybackDueMs ?? metrics.endToFirstAudioMs ?? metrics.speechEndToFirstAudioMs;
  const interruptionSlow = metrics.phase === 'interrupted' && Number.isFinite(metrics.interruptToSilenceMs) && metrics.interruptToSilenceMs > 800;
  const level = interruptionSlow || (Number.isFinite(mainLatency) && mainLatency > 3000) ? 'warn' : 'info';
  console[level]('[SEXTA Live Metrics]', JSON.stringify(metrics));
  return send(res, 200, { ok: true });
}
