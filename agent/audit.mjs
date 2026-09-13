import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MAX_LOG_BYTES = Math.max(256 * 1024, Number(process.env.SEXTA_AGENT_AUDIT_MAX_BYTES || 5 * 1024 * 1024));
const SECRET_KEYS = /token|password|senha|secret|authorization|imagebase64|clipboard|typedtext|inputtext|prompt/i;
let lastWriteError = '';
let lastWriteErrorAt = 0;

function defaultAuditPath() {
  const explicit = String(process.env.SEXTA_AGENT_AUDIT || '').trim();
  if (explicit) return path.resolve(explicit);

  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local'))
    : (process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'));

  return path.join(base, 'SEXTA', 'logs', 'agent-audit.log');
}

const AUDIT_PATH = defaultAuditPath();

function scrub(value, depth = 0, seen = new WeakSet()) {
  if (depth > 4) return '[depth-limit]';
  if (Array.isArray(value)) return value.slice(0, 20).map(v => scrub(v, depth + 1, seen));
  if (!value || typeof value !== 'object') {
    const text = String(value ?? '');
    return text.length > 500 ? `${text.slice(0, 500)}…` : value;
  }
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.test(key) ? '[redacted]' : scrub(item, depth + 1, seen);
  }
  seen.delete(value);
  return out;
}

function rotateIfNeeded() {
  let size = 0;
  try { size = fs.statSync(AUDIT_PATH).size; } catch { return; }
  if (size < MAX_LOG_BYTES) return;

  const rotated = `${AUDIT_PATH}.1`;
  try { fs.rmSync(rotated, { force: true }); } catch {}
  fs.renameSync(AUDIT_PATH, rotated);
}

function reportWriteFailure(error) {
  const message = String(error?.message || error || 'unknown audit write error');
  const now = Date.now();
  if (message === lastWriteError && now - lastWriteErrorAt < 30000) return;
  lastWriteError = message;
  lastWriteErrorAt = now;
  console.error(`[SEXTA Audit] Falha ao gravar ${AUDIT_PATH}: ${message}`);
}

export function audit(entry = {}) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_PATH), { recursive: true });
    rotateIfNeeded();
    const row = {
      at: new Date().toISOString(),
      pid: process.pid,
      commandId: String(entry.commandId || ''),
      action: String(entry.action || ''),
      status: String(entry.status || ''),
      ok: entry.ok === true,
      details: scrub(entry.details || {})
    };
    fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' });
    return { ok: true, path: AUDIT_PATH };
  } catch (error) {
    reportWriteFailure(error);
    return { ok: false, path: AUDIT_PATH, error: String(error?.message || error) };
  }
}

export function auditPath() { return AUDIT_PATH; }
