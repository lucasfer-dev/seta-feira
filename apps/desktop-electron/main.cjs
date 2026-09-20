const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, dialog, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;

const WEB_URL = process.env.SEXTA_WEB_URL || 'https://seta-feira.vercel.app';
let win; let overlay; let tray; let agent; let wakeProcess; let lastPresence = { state: 'standby' };
let agentRestartTimer = null; let wakeRestartTimer = null; let agentRestartDelay = 1500; let wakeRestartDelay = 1800;
let updateTimer = null; let updatePromptOpen = false;
let agentDiagnostics = { lastStartAt: '', lastOnlineAt: '', lastExitAt: '', lastExitCode: null, lastSignal: '', lastError: '', lastLog: '' };
let wakeDiagnostics = { ready: false, runtime: 'wake-runtime', culture: '', mode: '', availableCultures: '', audioState: '', lastWakeAt: '', lastPhrase: '', lastConfidence: 0, lastHeardAt: '', lastHeard: '', lastHeardConfidence: 0, lastError: '', lastExitCode: null, lastStartedAt: '' };

function desktopConfigPath() { return path.join(app.getPath('userData'), 'sexta-desktop.json'); }
function readDesktopConfig() { try { return JSON.parse(fs.readFileSync(desktopConfigPath(), 'utf8')); } catch { return {}; } }
function writeDesktopConfig(next) { const current = readDesktopConfig(); fs.mkdirSync(path.dirname(desktopConfigPath()), { recursive: true }); fs.writeFileSync(desktopConfigPath(), JSON.stringify({ ...current, ...next }, null, 2), 'utf8'); }
function selectedVaultPath() { return String(readDesktopConfig().vaultPath || ''); }
function overlayEnabled() { return readDesktopConfig().overlayEnabled !== false; }
function wakeWordEnabled() { return readDesktopConfig().wakeWordEnabled !== false; }
function agentResource(file) { return app.isPackaged ? path.join(process.resourcesPath, 'agent', file) : path.resolve(__dirname, '../../agent', file); }
function agentHome() { return app.isPackaged ? path.join(app.getPath('userData'), 'agent') : path.resolve(__dirname, '../../agent'); }
function agentConfigPath() { return path.join(agentHome(), 'config.json'); }
function agentEnvPath() { return app.isPackaged ? path.join(agentHome(), '.env.local') : path.resolve(__dirname, '../../.env.local'); }
function agentStatePath() { return path.join(agentHome(), 'runtime-state.json'); }
function agentAuditPath() { return path.join(agentHome(), 'audit.log'); }
function readAgentEnv() {
  const result = {}; try { for (const line of fs.readFileSync(agentEnvPath(), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) result[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch {} return result;
}
function atomicText(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, text, 'utf8'); fs.renameSync(tmp, file); }
function writeAgentEnv(updates = {}) {
  const current = readAgentEnv(); const merged = { ...current, ...updates };
  atomicText(agentEnvPath(), `${Object.entries(merged).map(([key, value]) => `${key}=${String(value ?? '').replace(/[\r\n]/g, '')}`).join('\n')}\n`);
}
function whereCommand(name) { const r = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true }); return r.status === 0 ? String(r.stdout || '').trim().split(/\r?\n/)[0] : ''; }
function firstExisting(paths = []) { return paths.filter(Boolean).find(p => fs.existsSync(p)) || ''; }
function detectBrowser() {
  return firstExisting([
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ]);
}
function safeRelativeNotePath(value) { const normalized = String(value || '').replace(/\\/g, '/').replace(/^\/+/, ''); if (!normalized || !normalized.toLowerCase().endsWith('.md')) throw new Error('VAULT_PATH_INVALID'); const parts = normalized.split('/').filter(Boolean); if (parts.some(p => p === '..' || p === '.')) throw new Error('VAULT_PATH_INVALID'); return parts.join('/'); }
function localNotePath(root, relative) { const safe = safeRelativeNotePath(relative); const resolved = path.resolve(root, ...safe.split('/')); const base = path.resolve(root) + path.sep; if (resolved !== path.resolve(root) && !resolved.startsWith(base)) throw new Error('VAULT_PATH_INVALID'); return resolved; }
async function walkMarkdown(root, current = root, out = []) { const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []); for (const entry of entries) { if (entry.name === '.obsidian' || entry.name === '.trash' || entry.name.startsWith('.git')) continue; const full = path.join(current, entry.name); if (entry.isDirectory()) await walkMarkdown(root, full, out); else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) { const [markdown, stat] = await Promise.all([fsp.readFile(full, 'utf8'), fsp.stat(full)]); out.push({ path: path.relative(root, full).split(path.sep).join('/'), markdown, clientUpdatedAt: stat.mtime.toISOString(), size: stat.size }); } } return out; }

function registerVaultIpc() {
  ipcMain.handle('vault:choose', async () => { const result = await dialog.showOpenDialog(win, { title: 'Escolha o Vault da SEXTA no Obsidian', properties: ['openDirectory', 'createDirectory'] }); if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true }; const vaultPath = result.filePaths[0]; await fsp.mkdir(vaultPath, { recursive: true }); writeDesktopConfig({ vaultPath }); return { ok: true, vaultPath }; });
  ipcMain.handle('vault:status', async () => { const vaultPath = selectedVaultPath(); return { configured: Boolean(vaultPath), vaultPath, exists: Boolean(vaultPath && fs.existsSync(vaultPath)) }; });
  ipcMain.handle('vault:read', async () => { const vaultPath = selectedVaultPath(); if (!vaultPath) return { configured: false, notes: [] }; await fsp.mkdir(vaultPath, { recursive: true }); return { configured: true, vaultPath, notes: await walkMarkdown(vaultPath) }; });
  ipcMain.handle('vault:write', async (_event, payload = {}) => { const vaultPath = selectedVaultPath(); if (!vaultPath) throw new Error('VAULT_NOT_CONFIGURED'); const notes = Array.isArray(payload.notes) ? payload.notes.slice(0, 600) : []; let written = 0; for (const note of notes) { if (!note?.path || typeof note.markdown !== 'string') continue; const full = localNotePath(vaultPath, note.path); await fsp.mkdir(path.dirname(full), { recursive: true }); const current = await fsp.readFile(full, 'utf8').catch(() => null); if (current !== note.markdown) { await fsp.writeFile(full, note.markdown, 'utf8'); written++; } } return { ok: true, written, vaultPath }; });
  ipcMain.handle('vault:open', async () => { const vaultPath = selectedVaultPath(); if (!vaultPath) throw new Error('VAULT_NOT_CONFIGURED'); const uri = `obsidian://open?path=${encodeURIComponent(vaultPath)}`; try { await shell.openExternal(uri); return { ok: true, method: 'obsidian' }; } catch { await shell.openPath(vaultPath); return { ok: true, method: 'folder' }; } });
}
function registerPresenceIpc() {
  ipcMain.on('presence:update', (_event, detail = {}) => { const state = String(detail.state || 'standby').slice(0, 40); lastPresence = { state, tool: detail.tool ? String(detail.tool).slice(0, 120) : null }; if (overlay && !overlay.isDestroyed()) overlay.webContents.send('presence:state', lastPresence); });
  ipcMain.on('overlay:open', () => { if (!win || win.isDestroyed()) return; win.show(); win.focus(); });
}

async function loadCloud() {
  if (!win || win.isDestroyed()) return { ok: false, reason: 'window_unavailable' };
  try { await win.loadURL(WEB_URL); return { ok: true, url: WEB_URL }; }
  catch (error) { await win.loadFile(path.join(__dirname, 'fallback.html')).catch(() => {}); return { ok: false, url: WEB_URL, error: String(error?.message || error) }; }
}
function openAgentControl() {
  if (!win || win.isDestroyed()) return { ok: false, error: 'window_unavailable' };
  win.show(); win.focus();
  win.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('sexta:open-agent-control',{detail:{source:'desktop'}}));").catch(() => {});
  return { ok: true };
}
function createWindow() {
  win = new BrowserWindow({ title: 'SEXTA', width: 1320, height: 860, minWidth: 980, minHeight: 680, show: false, backgroundColor: '#0b0f14', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('page-title-updated', event => { event.preventDefault(); win.setTitle('SEXTA'); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|obsidian:)/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.once('ready-to-show', () => win.show());
  win.on('close', event => { if (!app.isQuitting) { event.preventDefault(); win.hide(); } });
  void loadCloud();
}
function positionOverlay() { if (!overlay || overlay.isDestroyed()) return; const display = screen.getPrimaryDisplay(); const area = display.workArea; const bounds = overlay.getBounds(); overlay.setPosition(Math.round(area.x + area.width / 2 - bounds.width / 2), area.y + 12, false); }
function createOverlay() {
  overlay = new BrowserWindow({ width: 270, height: 66, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, show: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); overlay.loadFile(path.join(__dirname, 'overlay.html')); overlay.webContents.on('did-finish-load', () => overlay.webContents.send('presence:state', lastPresence)); overlay.once('ready-to-show', () => { positionOverlay(); if (overlayEnabled()) overlay.showInactive(); });
}
function setOverlayEnabled(enabled) { writeDesktopConfig({ overlayEnabled: Boolean(enabled) }); if (!overlay || overlay.isDestroyed()) return; if (enabled) { positionOverlay(); overlay.showInactive(); } else overlay.hide(); }

function canStartAgent() { const localEnv = readAgentEnv(); return Boolean(localEnv.SEXTA_AGENT_TOKEN || process.env.SEXTA_AGENT_TOKEN); }
function appendAgentLog(chunk) {
  const safe = String(chunk || '').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sa3\.[A-Za-z0-9._-]+/g, '[agent-token]');
  agentDiagnostics.lastLog = `${agentDiagnostics.lastLog}${safe}`.slice(-6000);
}
function agentProcessEnv(localEnv = {}) {
  return {
    ...process.env,
    ...localEnv,
    ELECTRON_RUN_AS_NODE: '1',
    SEXTA_AGENT_HOME: agentHome(),
    SEXTA_AGENT_CONFIG: agentConfigPath(),
    SEXTA_ENV_PATH: agentEnvPath(),
    SEXTA_AGENT_STATE: agentStatePath(),
    SEXTA_AGENT_AUDIT: agentAuditPath(),
    SEXTA_OBSIDIAN_VAULT_PATH: selectedVaultPath()
  };
}
function scheduleAgentRestart() {
  if (app.isQuitting || agentRestartTimer || !canStartAgent()) return;
  const delay = agentRestartDelay; agentRestartDelay = Math.min(30000, Math.round(agentRestartDelay * 1.8));
  agentRestartTimer = setTimeout(() => { agentRestartTimer = null; startAgent(); }, delay);
}
function startAgent() {
  if (agent || app.isQuitting) return;
  const agentPath = agentResource('start-cloud.mjs'); if (!fs.existsSync(agentPath) || !canStartAgent()) return;
  const localEnv = readAgentEnv(); fs.mkdirSync(agentHome(), { recursive: true });
  const child = spawn(process.execPath, [agentPath], { cwd: path.dirname(agentPath), env: agentProcessEnv(localEnv), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  agent = child; agentDiagnostics = { ...agentDiagnostics, lastStartAt: new Date().toISOString(), lastError: '', lastLog: '' };
  child.stdout?.on('data', appendAgentLog); child.stderr?.on('data', appendAgentLog);
  const stableTimer = setTimeout(() => { if (agent === child) { agentRestartDelay = 1500; agentDiagnostics.lastOnlineAt = new Date().toISOString(); } }, 30000);
  child.on('exit', (code, signal) => { clearTimeout(stableTimer); agentDiagnostics.lastExitAt = new Date().toISOString(); agentDiagnostics.lastExitCode = code; agentDiagnostics.lastSignal = signal || ''; if (agent === child) agent = null; scheduleAgentRestart(); });
  child.on('error', error => { clearTimeout(stableTimer); agentDiagnostics.lastError = String(error?.message || error).slice(0, 1200); if (agent === child) agent = null; scheduleAgentRestart(); });
}
function restartAgent() {
  if (agentRestartTimer) { clearTimeout(agentRestartTimer); agentRestartTimer = null; }
  agentRestartDelay = 1500; const current = agent; agent = null; try { current?.kill(); } catch {}
  setTimeout(startAgent, 450); return { ok: true, scheduled: true };
}
async function pairAgent(payload = {}) {
  const code = String(payload.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) throw new Error('PAIRING_CODE_INVALID');
  const desktop = readDesktopConfig();
  const deviceId = String(desktop.deviceId || `windows-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')}`).slice(0, 180);
  const deviceName = String(payload.deviceName || desktop.deviceName || os.hostname()).trim().slice(0, 120) || os.hostname();
  const response = await fetch(`${WEB_URL.replace(/\/$/, '')}/api/agent-pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, deviceId, deviceName }), signal: AbortSignal.timeout(12000) });
  const pair = await response.json().catch(() => ({}));
  if (!response.ok || !pair.token) throw new Error(pair.error || pair.message || `PAIRING_HTTP_${response.status}`);

  let existing = {}; try { existing = JSON.parse(fs.readFileSync(agentConfigPath(), 'utf8')); } catch {}
  const browser = detectBrowser(); const codeCommand = whereCommand('code'); const codexDetectedCommand = whereCommand('codex'); const codexCommand = codexDetectedCommand || 'codex';
  const config = {
    deviceName,
    apps: { ...(existing.apps || {}), ...(codeCommand ? { vscode: { command: codeCommand, args: [] } } : {}), ...(browser ? { browser: { command: browser, args: [] } } : {}) },
    projects: existing.projects || {},
    codex: { command: existing.codex?.command || codexCommand, timeoutMs: Number(existing.codex?.timeoutMs || 900000) },
    browser: { command: existing.browser?.command || browser, debugPort: Number(existing.browser?.debugPort || 9223), profileDir: existing.browser?.profileDir || path.join(agentHome(), 'browser-profile') },
    wakeWord: { ...(existing.wakeWord || {}), enabled: wakeWordEnabled(), phrases: ['sexta-feira', 'sexta feira', 'sexta'], engine: 'windows-system-speech' }
  };
  atomicText(agentConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
  writeAgentEnv({ SEXTA_BASE_URL: WEB_URL.replace(/\/$/, ''), SEXTA_AGENT_TOKEN: pair.token, SEXTA_DEVICE_ID: deviceId });
  writeDesktopConfig({ deviceId, deviceName, pairedAt: new Date().toISOString() });
  restartAgent();
  return { ok: true, deviceId, deviceName, protocol: pair.protocol || 3, agentConfigured: true, browserDetected: Boolean(browser), vscodeDetected: Boolean(codeCommand), codexDetected: Boolean(codexDetectedCommand) };
}

function stopWakeWord() { const current = wakeProcess; wakeProcess = null; try { current?.kill(); } catch {} }
function handleWake(event = {}) {
  if (!win || win.isDestroyed()) return;
  const phrase = String(event.phrase || 'sexta-feira').slice(0, 80);
  const command = String(event.command || '').trim().slice(0, 4000);
  const confidence = Number(event.confidence || 0);
  wakeDiagnostics = { ...wakeDiagnostics, ready:true, lastWakeAt:new Date().toISOString(), lastPhrase:phrase, lastConfidence:confidence, lastError:'' };
  if (overlay && !overlay.isDestroyed()) overlay.showInactive();
  const detail = JSON.stringify({ source:'windows', phrase, command, confidence });
  win.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('sexta:wake-word',{detail:${detail}}));`).catch(() => {});
}
function scheduleWakeRestart() { if (app.isQuitting || wakeRestartTimer || !wakeWordEnabled()) return; const delay = wakeRestartDelay; wakeRestartDelay = Math.min(30000, Math.round(wakeRestartDelay * 1.8)); wakeRestartTimer = setTimeout(() => { wakeRestartTimer = null; startWakeWord(); }, delay); }
function startWakeWord() {
  if (wakeProcess || !wakeWordEnabled() || app.isQuitting) return;

  const wakePath = agentResource('wake-runtime.mjs');
  if (!fs.existsSync(wakePath)) {
    wakeDiagnostics = { ...wakeDiagnostics, ready:false, lastError:'WAKE_RUNTIME_MISSING: wake-runtime.mjs não encontrado' };
    return;
  }

  const localEnv = readAgentEnv();
  const child = spawn(process.execPath, [wakePath], {
    cwd: path.dirname(wakePath),
    env: {
      ...process.env,
      ...localEnv,
      ELECTRON_RUN_AS_NODE: '1',
      SEXTA_WAKE_ALLOW_SYSTEM_SPEECH_FALLBACK:
        String(localEnv.SEXTA_WAKE_ALLOW_SYSTEM_SPEECH_FALLBACK || process.env.SEXTA_WAKE_ALLOW_SYSTEM_SPEECH_FALLBACK || 'true')
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  wakeProcess = child;
  wakeDiagnostics = {
    ...wakeDiagnostics,
    runtime:'wake-runtime',
    ready:false,
    lastStartedAt:new Date().toISOString(),
    lastExitCode:null,
    lastError:''
  };

  let buffer = '';
  let readyTimer = setTimeout(() => {
    if (wakeProcess !== child || wakeDiagnostics.ready) return;
    wakeDiagnostics = { ...wakeDiagnostics, lastError:'WAKE_ENGINE_START_TIMEOUT: runtime não enviou READY em 10s' };
    try { child.kill(); } catch {}
  }, 10000);

  child.stdout.on('data', chunk => {
    buffer += String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('READY\t')) {
        const parts = line.split('\t');
        clearTimeout(readyTimer);
        readyTimer = null;
        wakeDiagnostics = {
          ...wakeDiagnostics,
          ready:true,
          runtime:parts[1] || wakeDiagnostics.runtime,
          mode:parts[2] || '',
          lastError:''
        };
        continue;
      }

      if (line.startsWith('INFO\t')) {
        const parts = line.split('\t');
        wakeDiagnostics = { ...wakeDiagnostics, lastError: parts.slice(1).join(' | ').slice(0,900) };
        continue;
      }

      if (line.startsWith('ERROR\t')) {
        wakeDiagnostics = {
          ...wakeDiagnostics,
          ready:false,
          lastError:line.split('\t').slice(1).join(' | ').slice(0,900)
        };
        continue;
      }

      if (line.startsWith('AUDIO\t')) {
        wakeDiagnostics = { ...wakeDiagnostics, audioState:line.split('\t')[1] || '' };
        continue;
      }

      if (line.startsWith('HEARD\t')) {
        const parts = line.split('\t');
        wakeDiagnostics = {
          ...wakeDiagnostics,
          lastHeardAt:new Date().toISOString(),
          lastHeard:(parts[1] || '').slice(0,160),
          lastHeardConfidence:Number(parts[2] || 0)
        };
        continue;
      }

      if (!line.startsWith('WAKE\t')) continue;
      const [, phrase = '', confidence = '0', ...commandParts] = line.split('\t');
      handleWake({ phrase, confidence:Number(confidence) || 0, command:commandParts.join('\t') });
    }
  });

  child.stderr.on('data', chunk => {
    const message = String(chunk || '').trim();
    if (message) wakeDiagnostics = { ...wakeDiagnostics, ready:false, lastError:message.slice(-900) };
  });

  const stableTimer = setTimeout(() => {
    if (wakeProcess === child) wakeRestartDelay = 1800;
  }, 30000);

  child.on('exit', code => {
    clearTimeout(stableTimer);
    if (readyTimer) clearTimeout(readyTimer);
    wakeDiagnostics = {
      ...wakeDiagnostics,
      ready:false,
      lastExitCode:code,
      lastError:wakeDiagnostics.lastError || `WAKE_ENGINE_CRASHED: runtime saiu com código ${code}`
    };
    if (wakeProcess === child) wakeProcess = null;
    scheduleWakeRestart();
  });

  child.on('error', error => {
    clearTimeout(stableTimer);
    if (readyTimer) clearTimeout(readyTimer);
    wakeDiagnostics = {
      ...wakeDiagnostics,
      ready:false,
      lastError:`WAKE_ENGINE_CRASHED: ${String(error?.message || error).slice(0,700)}`
    };
    if (wakeProcess === child) wakeProcess = null;
    scheduleWakeRestart();
  });
}
function setWakeWordEnabled(enabled) { writeDesktopConfig({ wakeWordEnabled: Boolean(enabled) }); if (enabled) { wakeRestartDelay = 1800; startWakeWord(); } else { if (wakeRestartTimer) clearTimeout(wakeRestartTimer); wakeRestartTimer = null; stopWakeWord(); } }

async function checkForUpdates(interactive = false) {
  if (!app.isPackaged) { if (interactive) await dialog.showMessageBox(win, { type: 'info', title: 'SEXTA Update', message: 'Atualizações automáticas só funcionam no aplicativo instalado.', detail: `Versão de desenvolvimento: ${app.getVersion()}` }); return { ok: false, development: true }; }
  try { const result = await autoUpdater.checkForUpdates(); if (interactive && result?.updateInfo?.version === app.getVersion()) await dialog.showMessageBox(win, { type: 'info', title: 'SEXTA Update', message: 'Você já está na versão mais recente.', detail: `Versão ${app.getVersion()}` }); return { ok: true, version: result?.updateInfo?.version || null }; }
  catch (error) { if (interactive) await dialog.showMessageBox(win, { type: 'warning', title: 'SEXTA Update', message: 'Não foi possível verificar atualizações.', detail: String(error?.message || error).slice(0, 800) }); return { ok: false, error: String(error?.message || error) }; }
}
function configureUpdater() {
  if (!app.isPackaged) return; autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', async info => { if (updatePromptOpen) return; updatePromptOpen = true; try { const answer = await dialog.showMessageBox(win, { type: 'info', title: 'Atualização da SEXTA', message: `SEXTA ${info.version} disponível.`, detail: 'O download só começa com sua confirmação.', buttons: ['Baixar atualização', 'Depois'], defaultId: 0, cancelId: 1 }); if (answer.response === 0) await autoUpdater.downloadUpdate(); } finally { updatePromptOpen = false; } });
  autoUpdater.on('update-downloaded', async info => { const answer = await dialog.showMessageBox(win, { type: 'info', title: 'Atualização pronta', message: `SEXTA ${info.version} foi baixada.`, detail: 'Reinicie para aplicar a atualização.', buttons: ['Reiniciar e instalar', 'Depois'], defaultId: 0, cancelId: 1 }); if (answer.response === 0) { app.isQuitting = true; autoUpdater.quitAndInstall(false, true); } });
  autoUpdater.on('error', error => console.warn('[SEXTA Updater]', error?.message || error)); setTimeout(() => void checkForUpdates(false), 20000); updateTimer = setInterval(() => void checkForUpdates(false), 6 * 60 * 60 * 1000);
}

function registerSystemIpc() {
  ipcMain.handle('system:status', async () => ({ ok: true, version: app.getVersion(), packaged: app.isPackaged, cloudUrl: WEB_URL, deviceId: readDesktopConfig().deviceId || '', agent: { running: Boolean(agent), configured: canStartAgent(), configPath: agentConfigPath(), diagnostics: { ...agentDiagnostics } }, wakeWord: { enabled: wakeWordEnabled(), running: Boolean(wakeProcess), diagnostics: { ...wakeDiagnostics } }, overlay: { enabled: overlayEnabled() } }));
  ipcMain.handle('system:retry-cloud', async () => loadCloud());
  ipcMain.handle('system:restart-agent', async () => restartAgent());
  ipcMain.handle('system:setup-agent', async () => openAgentControl());
  ipcMain.handle('system:open-agent-control', async () => openAgentControl());
  ipcMain.handle('system:pair-agent', async (_event, payload = {}) => pairAgent(payload));
  ipcMain.handle('system:check-updates', async () => checkForUpdates(true));
}
function trayImage() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="#090604" stroke="#ff7a18" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="#ff7a18"/></svg>';
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`); return image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
}

async function showWakeDiagnostics() {
  const d = { ...wakeDiagnostics };
  const details = [
    `Versão do app: ${app.getVersion()}`,
    `Runtime: ${d.runtime || 'não informado'}`,
    `Processo: ${wakeProcess ? 'rodando' : 'parado'}`,
    `Pronto: ${d.ready ? 'sim' : 'não'}`,
    `Idioma reconhecedor: ${d.culture || 'não detectado'}`,
    `Modo: ${d.mode || 'não detectado'}`,
    `Reconhecedores instalados: ${d.availableCultures || d.culture || 'não detectado'}`,
    `Estado do áudio: ${d.audioState || 'não informado'}`,
    `Último áudio entendido: ${d.lastHeard || 'nenhum'}`,
    `Confiança do último áudio: ${Number(d.lastHeardConfidence || 0).toFixed(2)}`,
    `Último wake: ${d.lastWakeAt || 'nenhum'}`,
    `Última frase: ${d.lastPhrase || 'nenhuma'}`,
    `Confiança: ${Number(d.lastConfidence || 0).toFixed(2)}`,
    `Último erro: ${d.lastError || 'nenhum'}`
  ].join('\n');
  await dialog.showMessageBox(win, {
    type: d.ready ? 'info' : 'warning',
    title: 'Diagnóstico do Wake Word',
    message: d.ready ? 'Wake word está inicializada.' : 'Wake word não está pronta.',
    detail: details
  });
}

function createTray() {
  tray = new Tray(trayImage()); tray.setToolTip(`SEXTA ${app.getVersion()}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Sexta', click: () => { win.show(); win.focus(); } },
    { label: 'Mostrar ilha da SEXTA', type: 'checkbox', checked: overlayEnabled(), click: item => setOverlayEnabled(item.checked) },
    { label: 'Wake word “Sexta”', type: 'checkbox', checked: wakeWordEnabled(), click: item => setWakeWordEnabled(item.checked) },
    { label: 'Diagnóstico do Wake Word…', click: () => void showWakeDiagnostics() },
    { label: 'Configurações de microfone do Windows…', click: () => void shell.openExternal('ms-settings:privacy-microphone') },
    { label: 'Configurações de idioma/fala do Windows…', click: () => void shell.openExternal('ms-settings:regionlanguage') },
    { type: 'separator' },
    { label: 'Reiniciar PC Agent', click: () => restartAgent() },
    { label: 'Configurar / Parear PC Agent…', click: openAgentControl },
    { label: 'Verificar atualizações…', click: () => void checkForUpdates(true) },
    { label: 'Abrir Vault', click: async () => { const p = selectedVaultPath(); if (p) await shell.openExternal(`obsidian://open?path=${encodeURIComponent(p)}`).catch(() => shell.openPath(p)); } },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' }, { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } }
  ])); tray.on('double-click', () => { win.show(); win.focus(); });
}

app.whenReady().then(() => { registerVaultIpc(); registerPresenceIpc(); registerSystemIpc(); createWindow(); createOverlay(); createTray(); startAgent(); startWakeWord(); configureUpdater(); screen.on('display-metrics-changed', positionOverlay); screen.on('display-added', positionOverlay); screen.on('display-removed', positionOverlay); });
app.on('activate', () => { if (win) win.show(); else createWindow(); });
app.on('before-quit', () => { app.isQuitting = true; if (agentRestartTimer) clearTimeout(agentRestartTimer); if (wakeRestartTimer) clearTimeout(wakeRestartTimer); if (updateTimer) clearInterval(updateTimer); try { agent?.kill(); } catch {} stopWakeWord(); });