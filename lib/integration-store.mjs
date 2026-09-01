import crypto from 'node:crypto';
import { config } from './core.mjs';

const OWNER = 'owner';

function integrationKey() {
  return crypto.createHash('sha256').update(config().secret || 'sexta-local').digest();
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', integrationKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('SXI1'), iv, tag, data]).toString('base64');
}

function decryptJson(raw) {
  const buf = Buffer.from(String(raw || ''), 'base64');
  if (buf.subarray(0, 4).toString() !== 'SXI1') throw new Error('INTEGRATION_TOKEN_FORMAT');
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(16, 32);
  const data = buf.subarray(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', integrationKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}

async function request(path, { method = 'GET', query = {}, body, prefer = '' } = {}) {
  const c = config();
  if (!c.supabaseUrl || !c.supabaseKey || !c.supabaseApiKey) throw new Error('SUPABASE_NOT_CONFIGURED');
  const url = new URL(`${c.supabaseUrl}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers = {
    apikey: c.supabaseKey,
    Authorization: `Bearer ${c.supabaseKey}`,
    'x-sexta-api-key': c.supabaseApiKey,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`INTEGRATION_STORE_${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

export async function loadIntegration(provider) {
  const rows = await request('sexta_integrations', {
    query: {
      select: 'provider,secret_payload,metadata,created_at,updated_at',
      owner_id: `eq.${OWNER}`,
      provider: `eq.${String(provider || '').slice(0, 80)}`,
      limit: '1'
    }
  });
  const row = rows?.[0];
  if (!row) return null;
  return {
    provider: row.provider,
    secret: decryptJson(row.secret_payload),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function saveIntegration(provider, secret, metadata = {}) {
  const now = new Date().toISOString();
  const row = {
    owner_id: OWNER,
    provider: String(provider || '').slice(0, 80),
    secret_payload: encryptJson(secret),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    updated_at: now
  };
  const rows = await request('sexta_integrations', {
    method: 'POST',
    query: { on_conflict: 'owner_id,provider' },
    body: row,
    prefer: 'resolution=merge-duplicates,return=representation'
  });
  return rows?.[0] || row;
}

export async function deleteIntegration(provider) {
  await request('sexta_integrations', {
    method: 'DELETE',
    query: {
      owner_id: `eq.${OWNER}`,
      provider: `eq.${String(provider || '').slice(0, 80)}`
    },
    prefer: 'return=minimal'
  });
  return true;
}
