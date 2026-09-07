const { app, BrowserWindow, Menu, Tray, nativeImage, shell, ipcMain, dialog, screen } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;

const WEB_URL = process.env.SEXTA_WEB_URL || 'https://seta-feira.vercel.app';
let win; let overlay; let tray; let agent; let wakeProcess; let lastPresence = { state: 'standby' };

function desktopConfigPath() { return path.join(app.getPath('userData'), 'sexta-desktop.json'); }
function readDesktopConfig() { try { return JSON.parse(fs.readFileSync(desktopConfigPath(), 'utf8')); } catch { return {}; } }
function writeDesktopConfig(next) { const current = readDesktopConfig(); fs.mkdirSync(path.dirname(desktopConfigPath()), { recursive: true }); fs.writeFileSync(desktopConfigPath(), JSON.stringify({ ...current, ...next }, null, 2), 'utf8'); }
function selectedVaultPath() { return String(readDesktopConfig().vaultPath || ''); }
function overlayEnabled() { return readDesktopConfig().overlayEnabled !== false; }
function wakeWordEnabled() { return readDesktopConfig().wakeWordEnabled === true; }
function agentResource(file) { return app.isPackaged ? path.join(process.resourcesPath, 'agent', file) : path.resolve(__dirname, '../../agent', file); }
function agentHome() { return app.isPackaged ? path.join(app.getPath('userData'), 'agent') : path.resolve(__dirname, '../../agent'); }
function agentConfigPath() { return path.join(agentHome(), 'config.json'); }
function agentEnvPath() { return app.isPackaged ? path.join(agentHome(), '.env.local') : path.resolve(__dirname, '../../.env.local'); }
function readAgentEnv() {
  const result = {}; try { for (const line of fs.readFileSync(agentEnvPath(), 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) result[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } } catch {} return result;
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
function createWindow() {
  win = new BrowserWindow({ width: 1320, height: 860, minWidth: 980, minHeight: 680, show: false, backgroundColor: '#0b0f14', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|obsidian:)/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.once('ready-to-show', () => win.show());
  win.on('close', event => { if (!app.isQuitting) { event.preventDefault(); win.hide(); } });
  win.loadURL(WEB_URL).catch(() => win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<body style="font-family:sans-serif;background:#0b0f14;color:white;padding:32px"><h2>SEXTA</h2><p>O Core não respondeu. Verifique sua conexão com a SEXTA Cloud.</p></body>')));
}
function positionOverlay() { if (!overlay || overlay.isDestroyed()) return; const display = screen.getPrimaryDisplay(); const area = display.workArea; const bounds = overlay.getBounds(); overlay.setPosition(Math.round(area.x + area.width / 2 - bounds.width / 2), area.y + 12, false); }
function createOverlay() {
  overlay = new BrowserWindow({ width: 270, height: 66, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false, show: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  overlay.setAlwaysOnTop(true, 'screen-saver'); overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); overlay.loadFile(path.join(__dirname, 'overlay.html')); overlay.webContents.on('did-finish-load', () => overlay.webContents.send('presence:state', lastPresence)); overlay.once('ready-to-show', () => { positionOverlay(); if (overlayEnabled()) overlay.showInactive(); });
}
function setOverlayEnabled(enabled) { writeDesktopConfig({ overlayEnabled: Boolean(enabled) }); if (!overlay || overlay.isDestroyed()) return; if (enabled) { positionOverlay(); overlay.showInactive(); } else overlay.hide(); }

function startAgent() {
  const agentPath = agentResource('start-cloud.mjs'); if (!fs.existsSync(agentPath)) return;
  const localEnv = readAgentEnv(); if (!localEnv.SEXTA_AGENT_TOKEN && !process.env.SEXTA_AGENT_TOKEN) return;
  fs.mkdirSync(agentHome(), { recursive: true });
  agent = spawn(process.execPath, [agentPath], { cwd: path.dirname(agentPath), env: { ...process.env, ...localEnv, ELECTRON_RUN_AS_NODE: '1', SEXTA_AGENT_HOME: agentHome(), SEXTA_AGENT_CONFIG: agentConfigPath(), SEXTA_ENV_PATH: agentEnvPath() }, stdio: 'ignore', windowsHide: true });
  agent.on('exit', () => { agent = null; });
}
function runAgentSetup() {
  const setupPath = agentResource('setup.mjs'); if (!fs.existsSync(setupPath)) return;
  fs.mkdirSync(agentHome(), { recursive: true });
  const exe = process.execPath.replace(/'/g, "''"); const script = setupPath.replace(/'/g, "''");
  const child = spawn('powershell.exe', ['-NoExit', '-Command', `& '${exe}' '${script}'`], { detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', SEXTA_AGENT_HOME: agentHome(), SEXTA_AGENT_CONFIG: agentConfigPath(), SEXTA_ENV_PATH: agentEnvPath() } });
  child.unref();
}
function stopWakeWord() { try { wakeProcess?.kill(); } catch {} wakeProcess = null; }
function handleWake() {
  if (!win || win.isDestroyed()) return; win.show(); win.focus();
  if (overlay && !overlay.isDestroyed()) overlay.showInactive();
  win.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('sexta:wake-word',{detail:{source:'windows'}})); window.__sextaGeminiLive?.start?.();").catch(() => {});
}
function startWakeWord() {
  stopWakeWord(); if (!wakeWordEnabled()) return;
  const wakePath = agentResource('wake-word.mjs'); if (!fs.existsSync(wakePath)) return;
  wakeProcess = spawn(process.execPath, [wakePath, '--listen'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = ''; wakeProcess.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split(/\r?\n/); buffer = lines.pop() || ''; for (const line of lines) if (line.startsWith('WAKE\t')) handleWake(); });
  wakeProcess.on('exit', () => { wakeProcess = null; });
}
function setWakeWordEnabled(enabled) { writeDesktopConfig({ wakeWordEnabled: Boolean(enabled) }); if (enabled) startWakeWord(); else stopWakeWord(); }

function createTray() {
  tray = new Tray(nativeImage.createEmpty()); tray.setToolTip('SEXTA');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir Sexta', click: () => { win.show(); win.focus(); } },
    { label: 'Mostrar ilha da SEXTA', type: 'checkbox', checked: overlayEnabled(), click: item => setOverlayEnabled(item.checked) },
    { label: 'Wake word “Sexta”', type: 'checkbox', checked: wakeWordEnabled(), click: item => setWakeWordEnabled(item.checked) },
    { label: 'Configurar PC Agent…', click: runAgentSetup },
    { label: 'Abrir Vault', click: async () => { const p = selectedVaultPath(); if (p) await shell.openExternal(`obsidian://open?path=${encodeURIComponent(p)}`).catch(() => shell.openPath(p)); } },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: 'separator' }, { label: 'Sair', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

app.whenReady().then(() => { registerVaultIpc(); registerPresenceIpc(); createWindow(); createOverlay(); createTray(); startAgent(); startWakeWord(); screen.on('display-metrics-changed', positionOverlay); screen.on('display-added', positionOverlay); screen.on('display-removed', positionOverlay); });
app.on('activate', () => { if (win) win.show(); else createWindow(); });
app.on('before-quit', () => { app.isQuitting = true; if (agent) agent.kill(); stopWakeWord(); });
