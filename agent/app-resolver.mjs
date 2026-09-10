import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { focusWindowNative, listWindows } from './windows-control-v2.mjs';

const CACHE_MS = 60_000;
const BLOCKED_EXECUTABLES = new Set([
  'cmd.exe', 'powershell.exe', 'pwsh.exe', 'wscript.exe', 'cscript.exe', 'mshta.exe',
  'rundll32.exe', 'regsvr32.exe', 'reg.exe', 'schtasks.exe', 'wmic.exe'
]);
const BLOCKED_DYNAMIC_APP = /\b(?:powershell|pwsh|command prompt|prompt de comando|windows terminal|terminal|cmd|wscript|cscript|mshta|rundll32|regsvr32|registry editor|editor do registro|regedit)\b/i;

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
  ['steam', 'steam'],
  ['explorer', 'file explorer'],
  ['explorador', 'file explorer'],
  ['bloco de notas', 'notepad'],
  ['notepad', 'notepad']
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

export function isSafeExecutable(target = '') {
  const raw = String(target || '').trim();
  if (!raw || !path.win32.isAbsolute(raw) || path.win32.extname(raw).toLowerCase() !== '.exe') return false;
  if (BLOCKED_EXECUTABLES.has(path.win32.basename(raw).toLowerCase())) return false;
  return true;
}

export function isSafeDiscoveredApp(app = {}) {
  const name = String(app?.name || '').trim();
  const appId = String(app?.appId || '').trim();
  if (!name || BLOCKED_DYNAMIC_APP.test(name) || BLOCKED_DYNAMIC_APP.test(appId)) return false;
  if (app?.source === 'shortcut' || app?.source === 'apppath') return isSafeExecutable(app.target);
  if (app?.source === 'startapp') return Boolean(appId) && !/[\r\n]/.test(appId);
  return false;
}

export function selectInstalledApp(requested, apps = []) {
  const ranked = (Array.isArray(apps) ? apps : [])
    .filter(isSafeDiscoveredApp)
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
    child.stdout?.on('data', data => { out += data.toString('utf8'); });
    child.stderr?.on('data', data => { err += data.toString('utf8'); });
    child.on('error', error => finish(reject, error));
    child.on('close', code => code === 0
      ? finish(resolve, String(out || '').trim())
      : finish(reject, new Error(String(err || out || `powershell exit ${code}`).trim())));
    child.stdin?.on('error', error => { if (error?.code !== 'EPIPE') finish(reject, error); });
    child.stdin?.end(`[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8\r\n${String(script || '')}\r\n`, 'utf8');
  });
}

function parseJson(text, fallback = []) {
  try { return JSON.parse(String(text || '').trim()); } catch { return fallback; }
}

async function discoverInstalledApps() {
  if (process.platform !== 'win32') return [];
  if (Date.now() - cached.at < CACHE_MS && cached.apps.length) return cached.apps;

  const script = String.raw`
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
  foreach ($lnk in @($roots | ForEach-Object { Get-ChildItem $_ -Filter *.lnk -Recurse -ErrorAction SilentlyContinue } | Select-Object -First 600)) {
    try {
      $shortcut = $ws.CreateShortcut($lnk.FullName)
      $target = [string]$shortcut.TargetPath
      if ($target -and [IO.Path]::GetExtension($target) -ieq '.exe' -and (Test-Path $target)) {
        [void]$items.Add([pscustomobject]@{ name=[string]$lnk.BaseName; source='shortcut'; appId=''; target=$target })
      }
    } catch {}
  }
} catch {}
try {
  foreach($base in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')) {
    if(-not (Test-Path $base)){continue}
    foreach($key in @(Get-ChildItem $base -ErrorAction SilentlyContinue | Select-Object -First 500)) {
      try {
        $target=[string](Get-ItemPropertyValue $key.PSPath '(default)' -ErrorAction Stop)
        if($target -and [IO.Path]::GetExtension($target) -ieq '.exe' -and (Test-Path $target)) {
          $name=[IO.Path]::GetFileNameWithoutExtension($target)
          [void]$items.Add([pscustomobject]@{name=$name;source='apppath';appId='';target=$target})
        }
      } catch {}
    }
  }
} catch {}
@($items) | ConvertTo-Json -Depth 3 -Compress
`;

  const parsed = parseJson(await runPowerShell(script), []);
  const items = (Array.isArray(parsed) ? parsed : parsed ? [parsed] : [])
    .map(item => ({
      name: String(item?.name || '').trim().slice(0, 180),
      source: item?.source === 'shortcut' ? 'shortcut' : item?.source === 'apppath' ? 'apppath' : 'startapp',
      appId: String(item?.appId || '').trim().slice(0, 500),
      target: String(item?.target || '').trim()
    }))
    .filter(isSafeDiscoveredApp);

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

function windowScore(requested, window = {}) {
  const titleScore = scoreMatch(requested, window.title || '');
  const processScore = scoreMatch(requested, window.process || '');
  return Math.max(titleScore, processScore);
}

async function findOpenWindow(...names) {
  try {
    const snapshot = await listWindows(80);
    const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
    const ranked = windows.map(window => ({
      window,
      score: Math.max(...names.filter(Boolean).map(name => windowScore(name, window)), -1)
    })).filter(item => item.score >= 60)
      .sort((a, b) => b.score - a.score || Number(b.window.active) - Number(a.window.active));
    return ranked[0]?.window || null;
  } catch {
    return null;
  }
}

async function waitForVisibleWindow(names, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await findOpenWindow(...names);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

async function focusExisting(requested) {
  const existing = await findOpenWindow(requested, aliasName(requested));
  if (!existing) return null;
  const focus = await focusWindowNative(existing.title || requested, existing.hwnd);
  return { opened: true, alreadyOpen: true, focused: true, verified: focus.verified === true, app: requested, window: focus, matchedBy: 'existing_window' };
}

async function launchDiscovered(app, requested) {
  if (!isSafeDiscoveredApp(app)) throw new Error('APP_TARGET_NOT_SAFE');
  if (app.source === 'startapp') {
    spawnDetached('explorer.exe', [`shell:AppsFolder\\${app.appId}`]);
  } else if ((app.source === 'shortcut' || app.source === 'apppath') && fs.existsSync(app.target)) {
    spawnDetached(app.target, []);
  } else {
    throw new Error('APP_TARGET_NOT_SAFE');
  }
  const exeName = app.target ? path.win32.basename(app.target, path.win32.extname(app.target)) : '';
  const visible = await waitForVisibleWindow([requested, app.name, exeName], 9000);
  if (!visible) throw new Error('APP_LAUNCH_NOT_VERIFIED');
  const focus = await focusWindowNative(visible.title || app.name, visible.hwnd);
  return { opened: true, alreadyOpen: false, focused: true, verified: focus.verified === true, app: app.name, matchedBy: app.source === 'startapp' ? 'windows_start_apps' : app.source === 'apppath' ? 'windows_app_paths' : 'windows_shortcut', window: focus };
}

export async function launchApp(cfg = {}, requested = '') {
  const name = sanitizeRequestedApp(requested);

  const existing = await focusExisting(name);
  if (existing) return existing;

  const configured = resolveConfiguredApp(cfg.apps || {}, name);
  if (configured) {
    const command = String(configured.value.command || '').trim();
    const args = Array.isArray(configured.value.args) ? configured.value.args.map(String).slice(0, 20) : [];
    if (!command) throw new Error('APP_CONFIG_INVALID');
    spawnDetached(command, args);
    const exeName = path.win32.basename(command, path.win32.extname(command));
    const visible = await waitForVisibleWindow([name, configured.key, exeName], 9000);
    if (!visible) throw new Error('APP_LAUNCH_NOT_VERIFIED');
    const focus = await focusWindowNative(visible.title || configured.key, visible.hwnd);
    return { opened: true, alreadyOpen: false, focused: true, verified: focus.verified === true, app: configured.key, matchedBy: 'configured_allowlist', window: focus };
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
  return launchDiscovered(match, name);
}

export async function listInstalledAppsForDiagnostics() {
  const apps = await discoverInstalledApps();
  return apps.map(app => ({ name: app.name, source: app.source })).slice(0, 400);
}
