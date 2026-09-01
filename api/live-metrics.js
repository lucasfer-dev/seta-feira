import { isOwner, parseJson, send } from '../lib/core.mjs';

function boundedNumber(value, max = 120000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(max, Math.round(n)));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });

  const body = await parseJson(req).catch(() => ({}));
  const metrics = {
    platform: String(body.platform || 'unknown').slice(0, 24),
    speechEndToFirstAudioMs: boundedNumber(body.speechEndToFirstAudioMs),
    speechStartToFirstAudioMs: boundedNumber(body.speechStartToFirstAudioMs),
    firstServerEventMs: boundedNumber(body.firstServerEventMs),
    outputUnderruns: boundedNumber(body.outputUnderruns, 100),
    prebufferMs: boundedNumber(body.prebufferMs, 1000)
  };

  console.info('[SEXTA Live Metrics]', JSON.stringify(metrics));
  return send(res, 200, { ok: true });
}
