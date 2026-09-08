import { config, isOwner, parseJson, send } from '../lib/core.mjs';

function boundedNumber(value, max = 120000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n)));
}

function shortString(value, max = 80) {
  return String(value || '').slice(0, max);
}

function safeTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function compactExtras(body = {}) {
  const extras = {};
  const stringKeys = ['reason', 'toolNames', 'outputMode', 'audioSource'];
  const numberKeys = ['streak', 'count', 'failed', 'timeoutMs', 'closeCode', 'suppressedTurnCompletes'];
  const booleanKeys = ['hadTranscript', 'toolPending', 'awaitingContinuation', 'continuationActivity', 'hasAudio', 'hasOutputText'];
  for (const key of stringKeys) {
    if (body[key] != null) extras[key] = shortString(body[key], 500);
  }
  for (const key of numberKeys) {
    const n = boundedNumber(body[key], 120000);
    if (n != null) extras[key] = n;
  }
  for (const key of booleanKeys) {
    if (typeof body[key] === 'boolean') extras[key] = body[key];
  }
  return extras;
}

async function persistMetric(row) {
  const c = config();
  if (!c.supabaseUrl || !c.supabaseKey || !c.supabaseApiKey) return false;
  const response = await fetch(`${c.supabaseUrl}/rest/v1/sexta_live_metrics`, {
    method: 'POST',
    headers: {
      apikey: c.supabaseKey,
      Authorization: `Bearer ${c.supabaseKey}`,
      'x-sexta-api-key': c.supabaseApiKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) throw new Error(`SUPABASE_${response.status}: ${await response.text()}`);
  return true;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req).catch(() => ({}));
  const metrics = {
    kind: shortString(body.kind || 'legacy', 80),
    phase: shortString(body.phase || 'complete', 32),
    platform: shortString(body.platform || 'unknown', 24),
    turnId: shortString(body.turnId, 80),
    state: shortString(body.state, 32),

    speechEndToFirstAudioMs: boundedNumber(body.speechEndToFirstAudioMs),
    speechStartToFirstAudioMs: boundedNumber(body.speechStartToFirstAudioMs),
    firstServerEventMs: boundedNumber(body.firstServerEventMs),
    outputUnderruns: boundedNumber(body.outputUnderruns, 100),
    prebufferMs: boundedNumber(body.prebufferMs, 2000),
    gapMs: boundedNumber(body.gapMs, 5000),
    outputQueueMs: boundedNumber(body.outputQueueMs, 5000),
    outputBufferTargetMs: boundedNumber(body.outputBufferTargetMs, 2000),
    outputMode: shortString(body.outputMode, 40),

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
    bargeInRms: boundedNumber(body.bargeInRms, 32768),
    ...compactExtras(body)
  };

  const mainLatency = metrics.speechStartToInterimMs ?? metrics.endToPlaybackDueMs ?? metrics.endToFirstAudioMs ?? metrics.speechEndToFirstAudioMs;
  const interruptionSlow = metrics.phase === 'interrupted' && Number.isFinite(metrics.interruptToSilenceMs) && metrics.interruptToSilenceMs > 800;
  const recognitionSlow = Number.isFinite(metrics.speechStartToInterimMs) && metrics.speechStartToInterimMs > 2200;
  const outputStarved = metrics.kind === 'voice_core_v10:output_underrun';
  const reliabilityWarning = /(?:timeout|suppressed|closed_while_waiting)/i.test(metrics.kind);
  const level = interruptionSlow || recognitionSlow || outputStarved || reliabilityWarning || (Number.isFinite(mainLatency) && mainLatency > 3000) ? 'warn' : 'info';
  console[level]('[SEXTA Live Metrics]', JSON.stringify(metrics));

  try {
    await persistMetric({
      owner_id: 'owner',
      kind: metrics.kind,
      platform: metrics.platform,
      phase: metrics.phase,
      turn_id: metrics.turnId || null,
      state: metrics.state || null,
      metrics,
      client_timestamp: safeTimestamp(body.clientTimestamp)
    });
  } catch (error) {
    console.warn('[SEXTA Live Metrics] persist failed:', String(error?.message || error).slice(0, 500));
  }

  return send(res, 200, { ok: true });
}
