import crypto from 'node:crypto';
import { config } from './core.mjs';
import { saveIntegration } from './integration-store.mjs';

const GOOGLE_PROVIDER = 'google-workspace';
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/tasks'
];

function stateSignature(nonce) {
  return crypto.createHmac('sha256', config().secret).update(nonce).digest('base64url');
}

function verifyState(state) {
  const [timestamp, noncePart, sig] = String(state || '').split('.');
  if (!timestamp || !noncePart || !sig) return false;
  const nonce = `${timestamp}.${noncePart}`;
  if (Date.now() - Number(timestamp) > 10 * 60 * 1000) return false;
  const expected = stateSignature(nonce);
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
}

export async function exchangeGoogleCodeFresh(code, state) {
  if (!verifyState(state)) throw new Error('GOOGLE_OAUTH_BAD_STATE');

  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || 3000}/api/google/callback`).trim();
  if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(`GOOGLE_OAUTH_${response.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }

  // Important: never merge credentials from the previous Google account here.
  // A stale refresh_token from another account can silently switch SEXTA back
  // to that account as soon as the new access token expires.
  const fresh = {
    ...data,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 - 60_000
  };

  if (!fresh.refresh_token) {
    throw new Error('GOOGLE_REFRESH_TOKEN_MISSING_RECONNECT');
  }

  await saveIntegration(GOOGLE_PROVIDER, fresh, {
    scopes: GOOGLE_SCOPES,
    token_type: fresh.token_type || 'Bearer',
    connected: true
  });

  return { connected: true };
}
