import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AUDIT_PATH = process.env.SEXTA_AGENT_AUDIT || fileURLToPath(new URL('./audit.log', import.meta.url));
const SECRET_KEYS = /token|password|senha|secret|authorization|imagebase64|text/i;

function scrub(value, depth = 0) {
  if (depth > 3) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 12).map(v => scrub(v, depth + 1));
  if (!value || typeof value !== 'object') {
    const text = String(value ?? '');
    return text.length > 240 ? `${text.slice(0, 240)}…` : value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? '[redacted]' : scrub(item, depth + 1);
  }
  return out;
}

export function audit(entry = {}) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
    const row = {
      at: new Date().toISOString(),
      commandId: String(entry.commandId || ''),
      action: String(entry.action || ''),
      status: String(entry.status || ''),
      ok: entry.ok === true,
      details: scrub(entry.details || {})
    };
    fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(row)}\n`, 'utf8');
  } catch {}
}

export function auditPath() { return AUDIT_PATH; }
