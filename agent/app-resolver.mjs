import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CACHE_MS = 60_000;
const BLOCKED_EXECUTABLES = new Set([
  'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe',
  'rundll32.exe', 'regsvr32.exe', 'reg.exe', 'schtasks.exe', 'wmic.exe'
]);

const APP_ALIASES = new Map([
  ['chrome', 'google chrome'],
  ['google', 'google chrome'],
  ['edge', 'microsoft edge'],
  ['vscode', 'visual studio code'],
  ['vs code', 'visual studio code'],
  ['code', 'visual studio code'],
  ['zen', 'zen browser'],
  ['firefox', 'mozilla firefox'],
  ['whatsapp', 'whatsapp'],
  ['discord', 'discord'],
  ['spotify', 'spotify'],
  ['steam', 'steam']
]);

let cached = { at: 0, apps: [] };

export function normalizeAppName(value = '') {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeRequestedApp(value = '') {
  const raw = String(value || '').trim().slice(0, 120);
  if (!raw) throw new Error('APP_NAME_REQUIRED');
  if (/[\\/:;|<>`$\r\n]/.test(raw)) throw new Error('APP_NAME_INVALID');
  return raw;
}

function aliasName(value = '') {
  const normalized = normalizeAppName(value);
  return APP_ALIASES.get(normalized) || normalized;
}

function scoreMatch(requested, candidateName) {
  const q = aliasName(requested);
  const n = aliasName(candidateName);
  if (!q || !n) return -1;
  if (q === n) return 100;
  if (n.startsWith(`${q} `) || q.startsWith(`${n} `)) return 86;
  if (n.includes(q) || q.includes(n)) return 72;
  const qTokens = new Set(q.split(' ').filter(Boolean));
  const nTokens = new Set(n.split(' ').filter(Boolean));
  const overlap = [...qTokens].filter(token => nTokens.has(token)).length;
  if (!overlap) return -1;
  return 40 + Math.round(30 * overlap / Math.max(qTokens.size, nTokens.size));
}

export function selectInstalledApp(requested, apps = []) {
  const ranked = (Array.isArray(apps) ? apps : [])
    .map(app => ({ app, score: scoreMatch(requested, app?.name || '') }))
    .filter(item => item.score >= 60)
    .sort((a, b) => b.score - a.score || String(a.app?.name || '').length - String(b.app?.name || '').length);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score < 86 && ranked[0].score === ranked[1].score) return null;
  return ranked[0].app;
}

export function resolveConfiguredApp(apps = {}, requested = '') {
  const entries = Object.entries(apps || {}).map(([key, value]) => ({ key, value, name: key }));
  const exact = entries.find(entry => normalizeAppName(entry.key) === normalizeAppName(requested));
  if (exact?.value?.command) return exact;
  const aliased = entries.find(entry => aliasName(entry.key) === aliasName(requested));
  return aliased?.value?.command ? aliased : null;
}

export function isSafeExecutable(target = '') {
  const raw = String(target || '').trim();
  if (!raw || !path.isAbsolute(raw) || path.extname(raw).toLowerCase() !== '.exe') return false;
  if (BLOCKED_EXECUTABLES.has(path.basename(raw).toLowerCase())) return false;
  return true;
}

function runPowerShell(script, timeout = 10_000) {
  if (process.platform !== 'win32') return Promise.reject(new Error('PC_WINDOWS_ONLY'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '', err = '', settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish(reject, new Error('APP_DISCOVERY_TIMEOUT'));
    }, timeout);
    child.stdout?.on('data', data => { out += data; });
    child.stderr?.on('data', data => { err += data; });
    child.on('error', error => finish(reject, error));
    child.on('close', code => code === 0
      ? finish(resolve, String(out || '').trim())
      : finish(reject, new Error(String(err || out || `powershell exit ${code}`).trim())));
    child.stdin?.on('error', error => { if (error?.code !== 'EPIPE') finish(reject, error); });
    child.stdin?.end(`${String(script || '')}\r\n`, 'utf8');
  });
}

function parseJson(text, fallback = []) {
  try { return JSON.parse(String(text || '').trim()); } catch { return fallback; }
}

async function discoverInstalledApps() {
  if (process.platform !== 'win32') return [];
  if (Date.now() - cached.at < CACHE_MS && cached.apps.length) return cached.apps;

  const script = String.raw`
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$items = New-Object System.Collections.ArrayList
try {
  foreach ($app in @(Get-StartApps)) {
    if ($app.Name -and $app.AppID) {
      [void]$items.Add([pscustomobject]@{ name=[string]$app.Name; source='startapp'; appId=[string]$app.AppID; target='' })
    }
  }
} catch {}
$roots = @(
  (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\\Windows\\Start Menu\\Programs'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:PUBLIC 'Desktop')
) | Where-Object { $_ -and (Test-Path $_) }
try {
  $ws = New-Object -ComObject WScript.Shell
  foreach ($lnk in @($roots | ForEach-Object { Get-ChildItem $_ -Filter *.lnk -Recurse -ErrorAction SilentlyContinue } | Select-Object -First 400)) {
    try {
      $shortcut = $ws.CreateShortcut($lnk.FullName)
      $target = [string]$shortcut.TargetPath
      if ($target -and [IO.Path]::GetExtension($target) -ieq '.exe' -and (Test-Path $target)) {
        [void]$items.Add([pscustomobject]@{ name=[string]$lnk.BaseName; source='shortcut'; appId=''; target=$target })
      }
    } catch {}
  }
} catch {}
@($items) | ConvertTo-Json -Depth 3 -Compress
`;

  const parsed = parseJson(await runPowerShell(script), []);
  const items = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : [])
    .map(item => ({
      name: String(item?.name || '').trim().slice(0, 180),
      source: item?.source === 'shortcut' ? 'shortcut' : 'startapp',
      appId: String(item?.appId || '').trim().slice(0, 500),
      target: String(item?.target || '').trim()
    }))
    .filter(item => item.name && (item.appId || isSafeExecutable(item.target)));

  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${normalizeAppName(item.name)}|${item.appId || item.target.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  cached = { at: Date.now(), apps: unique };
  return unique;
}

function spawnDetached(command, args = []) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
}

async function launchDiscovered(app) {
  if (app?.source === 'startapp' && app.appId) {
    if (/\r|\n/.test(app.appId)) throw new Error('APP_ID_INVALID');
    spawnDetached('explorer.exe', [`shell:AppsFolder\\${app.appId}`]);
    return { opened: true, app: app.name, matchedBy: 'windows_start_apps' };
  }
  if (app?.source === 'shortcut' && isSafeExecutable(app.target) && fs.existsSync(app.target)) {
    spawnDetached(app.target, []);
    return { opened: true, app: app.name, matchedBy: 'windows_shortcut' };
  }
  throw new Error('APP_TARGET_NOT_SAFE');
}

export async function launchApp(cfg = {}, requested = '') {
  const name = sanitizeRequestedApp(requested);
  const configured = resolveConfiguredApp(cfg.apps || {}, name);
  if (configured) {
    const command = String(configured.value.command || '').trim();
    const args = Array.isArray(configured.value.args) ? configured.value.args.map(String).slice(0, 20) : [];
    if (!command) throw new Error('APP_CONFIG_INVALID');
    spawnDetached(command, args);
    return { opened: true, app: configured.key, matchedBy: 'configured_allowlist' };
  }

  const installed = await discoverInstalledApps();
  const match = selectInstalledApp(name, installed);
  if (!match) {
    const suggestions = installed
      .map(app => ({ name: app.name, score: scoreMatch(name, app.name) }))
      .filter(item => item.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(item => item.name);
    throw new Error(`APP_NOT_FOUND${suggestions.length ? `: ${suggestions.join(', ')}` : ''}`);
  }
  return launchDiscovered(match);
}

export async function listInstalledAppsForDiagnostics() {
  const apps = await discoverInstalledApps();
  return apps.map(app => ({ name: app.name, source: app.source })).slice(0, 250);
}
