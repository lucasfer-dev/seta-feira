import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const SECURE_VAULT_VERSION = '1.0.0-dpapi';
const VAULT_PATH = process.env.SEXTA_SECURE_VAULT || path.join(process.env.APPDATA || path.join(os.homedir(), '.sexta'), 'SEXTA', 'secure-vault.json');

function readFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
    return { version: SECURE_VAULT_VERSION, secrets: {}, ...parsed, secrets: parsed.secrets || {} };
  } catch { return { version: SECURE_VAULT_VERSION, secrets: {} }; }
}
function writeFile(data) {
  fs.mkdirSync(path.dirname(VAULT_PATH), { recursive: true });
  fs.writeFileSync(VAULT_PATH, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}
function psWithInput(script, input) {
  if (process.platform !== 'win32') return Promise.reject(new Error('SECURE_VAULT_WINDOWS_REQUIRED'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {}; reject(new Error('SECURE_VAULT_TIMEOUT')); }, 8000);
    child.stdout.on('data', chunk => out += chunk);
    child.stderr.on('data', chunk => err += chunk);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `SECURE_VAULT_EXIT_${code}`)); });
    child.stdin.end(String(input ?? ''), 'utf8');
  });
}
async function protect(value) {
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); $e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Convert]::ToBase64String($e)`;
  return psWithInput(script, value);
}
async function unprotect(cipher) {
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Text.Encoding]::UTF8.GetString($p)`;
  return psWithInput(script, cipher);
}
function normalizeAlias(alias) {
  const value = String(alias || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(value)) throw new Error('SECURE_VAULT_ALIAS_INVALID');
  return value;
}

export function listSecretAliases() { return Object.keys(readFile().secrets).sort(); }
export function hasSecret(alias) { try { return Boolean(readFile().secrets[normalizeAlias(alias)]); } catch { return false; } }
export function secureVaultStatus() { return { version: SECURE_VAULT_VERSION, available: process.platform === 'win32', path: VAULT_PATH, aliases: listSecretAliases() }; }
export async function setSecret(alias, value) {
  const key = normalizeAlias(alias);
  const plain = String(value ?? '');
  if (!plain) throw new Error('SECURE_VAULT_VALUE_REQUIRED');
  const data = readFile();
  data.secrets[key] = { cipher: await protect(plain), updatedAt: new Date().toISOString() };
  writeFile(data);
  return { alias: key, saved: true };
}
export async function deleteSecret(alias) {
  const key = normalizeAlias(alias); const data = readFile(); const existed = Boolean(data.secrets[key]); delete data.secrets[key]; writeFile(data); return existed;
}
export async function resolveSecret(alias) {
  const key = normalizeAlias(alias); const entry = readFile().secrets[key]; if (!entry?.cipher) throw new Error('SECURE_VAULT_SECRET_NOT_FOUND'); return unprotect(entry.cipher);
}
