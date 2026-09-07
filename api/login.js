import { config, createOwnerToken, modeInfo, parseJson, send } from '../lib/core.mjs';

const attempts = new Map();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function clientKey(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}
function consumeAttempt(req) {
  const key = clientKey(req); const now = Date.now(); const current = attempts.get(key);
  if (!current || now - current.startedAt > WINDOW_MS) { attempts.set(key, { startedAt: now, count: 1 }); return true; }
  current.count += 1; return current.count <= MAX_ATTEMPTS;
}
function resetAttempts(req) { attempts.delete(clientKey(req)); }

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  if (!consumeAttempt(req)) return send(res, 429, { error: 'login_rate_limited', message: 'Muitas tentativas. Aguarde alguns minutos.' });
  const c = config();
  if (modeInfo().cloud && !process.env.SEXTA_SERVER_SECRET) return send(res, 503, { error: 'secure_auth_not_configured' });
  const body = await parseJson(req);
  if (!c.pin) {
    if (c.supabaseUrl && c.supabaseKey) return send(res, 503, { error: 'cloud_requires_access_pin' });
    resetAttempts(req);
    return send(res, 200, { token: 'demo-owner', demo: true });
  }
  if (String(body.pin || '') !== c.pin) return send(res, 401, { error: 'invalid_pin' });
  resetAttempts(req);
  return send(res, 200, { token: createOwnerToken(), demo: false });
}
