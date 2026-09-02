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
    kind: shortString(body.kind || 'legacy', 40),
    phase: shortString(body.phase || 'complete', 32),
    platform: shortString(body.platform || 'unknown', 24),
    turnId: shortString(body.turnId, 80),

    speechEndToFirstAudioMs: boundedNumber(body.speechEndToFirstAudioMs),
    speechStartToFirstAudioMs: boundedNumber(body.speechStartToFirstAudioMs),
    firstServerEventMs: boundedNumber(body.firstServerEventMs),
    outputUnderruns: boundedNumber(body.outputUnderruns, 100),
    prebufferMs: boundedNumber(body.prebufferMs, 1000),

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

    // Browser recognition path (speech -> live transcript -> response).
    speechStartToInterimMs: boundedNumber(body.speechStartToInterimMs),
    speechStartToFinalMs: boundedNumber(body.speechStartToFinalMs),
    speechStartToSpeakingMs: boundedNumber(body.speechStartToSpeakingMs),
    trackSampleRate: boundedNumber(body.trackSampleRate, 192000),
    trackSampleSize: boundedNumber(body.trackSampleSize, 64),
    trackChannelCount: boundedNumber(body.trackChannelCount, 8),
    trackLatencyMs: boundedNumber(body.trackLatencyMs, 10000),
    echoCancellation: body.echoCancellation === true,
    noiseSuppression: body.noiseSuppression === true,
    autoGainControl: body.autoGainControl === true,

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

  const mainLatency = metrics.speechStartToInterimMs ?? metrics.endToPlaybackDueMs ?? metrics.endToFirstAudioMs ?? metrics.speechEndToFirstAudioMs;
  const interruptionSlow = metrics.phase === 'interrupted' && Number.isFinite(metrics.interruptToSilenceMs) && metrics.interruptToSilenceMs > 800;
  const recognitionSlow = Number.isFinite(metrics.speechStartToInterimMs) && metrics.speechStartToInterimMs > 2200;
  const level = interruptionSlow || recognitionSlow || (Number.isFinite(mainLatency) && mainLatency > 3000) ? 'warn' : 'info';
  console[level]('[SEXTA Live Metrics]', JSON.stringify(metrics));
  return send(res, 200, { ok: true });
}
