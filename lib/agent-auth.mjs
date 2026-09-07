import crypto from 'node:crypto';
import { bearer, config, isAgent } from './core.mjs';

const PREFIX = 'sexta-agent-v3';
const PAIR_WINDOW_MS = 2 * 60 * 1000;
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function secret() {
  const value = String(config().secret || '');
  if (!value || value === 'local-development-secret') return value;
  return value;
}

function mac(input) {
  return crypto.createHmac('sha256', secret()).update(`${PREFIX}:${input}`).digest();
}

function b64url(value) { return Buffer.from(value).toString('base64url'); }

function codeForStep(step) {
  const digest = mac(`pair:${step}`);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ALPHABET[digest[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function currentPairingCode(now = Date.now()) {
  const step = Math.floor(now / PAIR_WINDOW_MS);
  const expiresAt = (step + 1) * PAIR_WINDOW_MS;
  return { code: codeForStep(step), expiresAt: new Date(expiresAt).toISOString(), expiresInMs: expiresAt - now };
}

export function verifyPairingCode(value, now = Date.now()) {
  const received = String(value || '').trim().toUpperCase();
  if (!received || received.length !== 9) return false;
  const step = Math.floor(now / PAIR_WINDOW_MS);
  for (const candidateStep of [step, step - 1]) {
    const expected = codeForStep(candidateStep);
    try {
      if (crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected))) return true;
    } catch {}
  }
  return false;
}

export function issueAgentToken(deviceId, now = Date.now()) {
  const id = String(deviceId || '').trim().slice(0, 180);
  if (!id) throw new Error('DEVICE_ID_REQUIRED');
  const payload = b64url(JSON.stringify({ sub: 'sexta-agent', deviceId: id, iat: now, exp: now + TOKEN_TTL_MS, v: 3 }));
  const signature = b64url(mac(`token:${payload}`));
  return `sa3.${payload}.${signature}`;
}

export function verifyAgentToken(token, expectedDeviceId = '') {
  const [prefix, payload, signature] = String(token || '').split('.');
  if (prefix !== 'sa3' || !payload || !signature) return null;
  const expected = b64url(mac(`token:${payload}`));
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsed.sub !== 'sexta-agent' || Number(parsed.exp) <= Date.now()) return null;
    if (expectedDeviceId && parsed.deviceId !== expectedDeviceId) return null;
    return parsed;
  } catch { return null; }
}

export function requestDeviceId(req, fallback = '') {
  return String(req.headers?.['x-sexta-device-id'] || req.headers?.['X-SEXTA-Device-ID'] || fallback || '').trim();
}

export function isAgentRequest(req, expectedDeviceId = '') {
  if (isAgent(req)) return true;
  const deviceId = expectedDeviceId || requestDeviceId(req);
  return Boolean(verifyAgentToken(bearer(req), deviceId));
}

export function agentTokenInfo(req) {
  const deviceId = requestDeviceId(req);
  return verifyAgentToken(bearer(req), deviceId) || null;
}
