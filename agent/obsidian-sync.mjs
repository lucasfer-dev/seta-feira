import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || !normalized.toLowerCase().endsWith('.md')) throw new Error('VAULT_PATH_INVALID');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some(p => p === '.' || p === '..')) throw new Error('VAULT_PATH_INVALID');
  return parts.join('/');
}

function localPath(root, relative) {
  const safe = safeRelative(relative);
  const resolved = path.resolve(root, ...safe.split('/'));
  const base = path.resolve(root) + path.sep;
  if (resolved !== path.resolve(root) && !resolved.startsWith(base)) throw new Error('VAULT_PATH_INVALID');
  return resolved;
}

async function walk(root, current = root, out = []) {
  const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === '.obsidian' || entry.name === '.trash' || entry.name.startsWith('.git')) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const [markdown, stat] = await Promise.all([fsp.readFile(full, 'utf8'), fsp.stat(full)]);
      out.push({
        path: path.relative(root, full).split(path.sep).join('/'),
        markdown,
        clientUpdatedAt: stat.mtime.toISOString()
      });
    }
  }
  return out;
}

export function obsidianVaultPath() {
  return String(process.env.SEXTA_OBSIDIAN_VAULT_PATH || '').trim();
}

export function obsidianSyncAvailable() {
  const root = obsidianVaultPath();
  return Boolean(root && fs.existsSync(root));
}

export async function syncObsidianVault({ baseUrl, headers, deviceId }) {
  const root = obsidianVaultPath();
  if (!root) return { ok: false, configured: false, pushed: 0, pulled: 0 };
  await fsp.mkdir(root, { recursive: true });

  const localNotes = await walk(root);
  let pushed = 0;
  if (localNotes.length) {
    const response = await fetch(`${baseUrl}/api/agent-vault`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ deviceId, notes: localNotes.slice(0, 500) }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`agent-vault push: ${response.status} ${await response.text()}`);
    const data = await response.json();
    pushed = Number(data.saved || 0);
  }

  const pull = await fetch(`${baseUrl}/api/agent-vault?deviceId=${encodeURIComponent(deviceId)}`, {
    headers,
    signal: AbortSignal.timeout(30000)
  });
  if (!pull.ok) throw new Error(`agent-vault pull: ${pull.status} ${await pull.text()}`);
  const cloud = await pull.json();

  let pulled = 0;
  for (const note of Array.isArray(cloud.notes) ? cloud.notes : []) {
    if (!note?.path || typeof note.markdown !== 'string') continue;
    const full = localPath(root, note.path);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    const current = await fsp.readFile(full, 'utf8').catch(() => null);
    if (current !== note.markdown) {
      await fsp.writeFile(full, note.markdown, 'utf8');
      pulled += 1;
    }
  }

  return {
    ok: true,
    configured: true,
    pushed,
    pulled,
    localNotes: localNotes.length,
    cloudNotes: Array.isArray(cloud.notes) ? cloud.notes.length : 0,
    syncedAt: new Date().toISOString()
  };
}
