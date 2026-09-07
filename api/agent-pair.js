import { isOwner, modeInfo, parseJson, send } from '../lib/core.mjs';
import { currentPairingCode, issueAgentToken, verifyPairingCode } from '../lib/agent-auth.mjs';

const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function allowedAttempt(req) {
  const key = clientKey(req);
  const now = Date.now();
  const row = attempts.get(key);
  if (!row || now - row.startedAt > WINDOW_MS) {
    attempts.set(key, { startedAt: now, count: 1 });
    return true;
  }
  row.count += 1;
  return row.count <= MAX_ATTEMPTS;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
    const pair = currentPairingCode();
    return send(res, 200, { ok: true, ...pair, format: 'XXXX-XXXX', protocol: 3 });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!allowedAttempt(req)) return send(res, 429, { error: 'pairing_rate_limited' });
  if (modeInfo().cloud && !process.env.SEXTA_SERVER_SECRET) return send(res, 503, { error: 'secure_pairing_not_configured' });

  const body = await parseJson(req);
  const deviceId = String(body.deviceId || '').trim().slice(0, 180);
  const deviceName = String(body.deviceName || '').trim().slice(0, 120);
  if (!deviceId) return send(res, 400, { error: 'device_id_required' });
  if (!verifyPairingCode(body.code)) return send(res, 401, { error: 'pairing_code_invalid_or_expired' });

  try {
    const token = issueAgentToken(deviceId);
    return send(res, 200, {
      ok: true,
      token,
      deviceId,
      deviceName,
      protocol: 3,
      expiresInDays: 180
    });
  } catch (error) {
    return send(res, 500, { error: 'pairing_failed', message: String(error?.message || error) });
  }
}
