import crypto from 'node:crypto';

const buckets = new Map();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const BLOCK_MS = 15 * 60_000;

function clientAddress(req = {}) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}

export function loginRateKey(req, secret = '') {
  return crypto.createHmac('sha256', secret || 'sexta-rate-limit').update(clientAddress(req)).digest('hex');
}

export function checkLoginRate(key, now = Date.now()) {
  const bucket = buckets.get(key);
  if (!bucket) return { allowed: true, remaining: MAX_FAILURES };
  if (bucket.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)), remaining: 0 };
  }
  if (now - bucket.windowStartedAt >= WINDOW_MS) {
    buckets.delete(key);
    return { allowed: true, remaining: MAX_FAILURES };
  }
  return { allowed: true, remaining: Math.max(0, MAX_FAILURES - bucket.failures) };
}

export function recordLoginFailure(key, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStartedAt >= WINDOW_MS) bucket = { failures: 0, windowStartedAt: now, blockedUntil: 0 };
  bucket.failures += 1;
  if (bucket.failures >= MAX_FAILURES) bucket.blockedUntil = now + BLOCK_MS;
  buckets.set(key, bucket);
  return checkLoginRate(key, now);
}

export function clearLoginFailures(key) {
  buckets.delete(key);
}

export function secureStringEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(right ?? '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export const __test__ = { buckets, MAX_FAILURES, BLOCK_MS };
