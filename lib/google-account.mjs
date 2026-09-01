import { config } from './core.mjs';
import { loadIntegration, saveIntegration } from './integration-store.mjs';

const GOOGLE_PROVIDER = 'google-workspace';

function hasCloudStore() {
  const c = config();
  return Boolean(c.supabaseUrl && c.supabaseKey && c.supabaseApiKey);
}

async function refreshAccessToken(token) {
  if (token?.access_token && Number(token.expires_at || 0) > Date.now() + 15_000) return token;
  if (!token?.refresh_token) throw new Error('GOOGLE_RECONNECT_REQUIRED');

  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) throw new Error('GOOGLE_OAUTH_NOT_CONFIGURED');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error(`GOOGLE_REFRESH_${response.status}`);

  const next = {
    ...token,
    ...data,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 - 60_000
  };
  if (hasCloudStore()) {
    await saveIntegration(GOOGLE_PROVIDER, next, {
      token_type: next.token_type || 'Bearer',
      connected: true
    });
  }
  return next;
}

export async function getConnectedGoogleAccount() {
  if (!hasCloudStore()) throw new Error('GOOGLE_TOKEN_STORE_UNAVAILABLE');
  const integration = await loadIntegration(GOOGLE_PROVIDER);
  let token = integration?.secret || null;
  if (!token) throw new Error('GOOGLE_NOT_CONNECTED');
  token = await refreshAccessToken(token);

  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(15000)
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`GOOGLE_USERINFO_${response.status}`);

  return {
    email: String(profile.email || '').trim(),
    name: String(profile.name || profile.given_name || '').trim(),
    verified: Boolean(profile.email_verified)
  };
}

export function isGoogleAccountQuestion(text = '') {
  const value = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ' ').replace(/\s+/g, ' ').trim();
  const mentionsIdentity = /\b(?:google|gmail|e-?mail|conta)\b/.test(value);
  if (!mentionsIdentity) return false;

  if (/\b(?:qual|que)\s+(?:e\s+)?(?:o\s+)?meu\s+(?:e-?mail|gmail)\b/.test(value)) return true;
  if (/\bmeu\s+(?:e-?mail|gmail)\s+(?:atual|conectado|logado|ativo)\b/.test(value)) return true;
  if (/\b(?:qual|que)\s+conta\s+(?:do\s+)?google\b/.test(value)) return true;

  const asksIdentity = /\b(?:qual|que|quem|mostra|diz|fala|ver|veja)\b/.test(value)
    && /\b(?:email|e-?mail|gmail|conta)\b/.test(value)
    && /\b(?:logad[oa]|conectad[oa]|vinculad[oa]|autorizad[oa]|usando|ativa|atual)\b/.test(value);
  return asksIdentity;
}
