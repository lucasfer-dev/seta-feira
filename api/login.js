import { config, createOwnerToken, parseJson, send } from '../lib/core.mjs';
import { checkLoginRate, clearLoginFailures, loginRateKey, recordLoginFailure, secureStringEqual } from '../lib/login-rate-limit.mjs';
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const c = config();
  const rateKey = loginRateKey(req, c.secret);
  const rate = checkLoginRate(rateKey);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSeconds));
    return send(res, 429, { error: 'too_many_login_attempts', retryAfterSeconds: rate.retryAfterSeconds });
  }
  const body = await parseJson(req);
  if (!c.pin) {
    if (c.supabaseUrl && c.supabaseKey) return send(res, 503, { error: 'cloud_requires_access_pin' });
    return send(res, 200, { token: 'demo-owner', demo: true });
  }
  if (!secureStringEqual(body.pin, c.pin)) {
    const failed = recordLoginFailure(rateKey);
    if (!failed.allowed) res.setHeader('Retry-After', String(failed.retryAfterSeconds));
    return send(res, failed.allowed ? 401 : 429, {
      error: failed.allowed ? 'invalid_pin' : 'too_many_login_attempts',
      ...(failed.retryAfterSeconds ? { retryAfterSeconds: failed.retryAfterSeconds } : {})
    });
  }
  clearLoginFailures(rateKey);
  send(res, 200, { token: createOwnerToken(), demo: false });
}
