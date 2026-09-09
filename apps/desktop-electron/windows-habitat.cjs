const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');

const COMPACT_BOUNDS = { width: 286, height: 68 };
const PALETTE_BOUNDS = { width: 540, height: 348 };
const PALETTE_SHORTCUTS = ['CommandOrControl+Shift+Space', 'CommandOrControl+Alt+K'];
const VOICE_SHORTCUTS = ['CommandOrControl+Alt+Space', 'CommandOrControl+Alt+M'];

let paletteShortcut = '';
let voiceShortcut = '';
let expanded = false;
let overlayBlurHandler = null;

function safeUrl(win) {
  try { return String(win?.webContents?.getURL?.() || ''); } catch { return ''; }
}

function overlayWindow() {
  return BrowserWindow.getAllWindows().find(win => /\/overlay\.html(?:$|[?#])/.test(safeUrl(win))) || null;
}

function mainWindow() {
  const windows = BrowserWindow.getAllWindows();
  return windows.find(win => {
    const url = safeUrl(win);
    return !/\/overlay\.html(?:$|[?#])/.test(url) && (/^https?:\/\//i.test(url) || /fallback\.html(?:$|[?#])/.test(url));
  }) || windows.find(win => !/\/overlay\.html(?:$|[?#])/.test(safeUrl(win))) || null;
}

function currentDisplay() {
  try { return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); }
  catch { return screen.getPrimaryDisplay(); }
}

function positionFor(bounds) {
  const area = currentDisplay().workArea;
  return {
    x: Math.round(area.x + area.width / 2 - bounds.width / 2),
    y: Math.round(area.y + 14)
  };
}

function sendToMain(channel, payload, options = {}) {
  const win = mainWindow();
  if (!win || win.isDestroyed()) return false;
  const send = () => {
    if (win.isDestroyed()) return;
    win.webContents.send(channel, payload || {});
    if (options.show) {
      win.show();
      win.focus();
    }
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
  return true;
}

function sendOverlayMode(mode) {
  const overlay = overlayWindow();
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('habitat:mode', {
    mode,
    shortcuts: { palette: paletteShortcut, voice: voiceShortcut }
  });
}

function detachBlurHandler(overlay) {
  if (!overlay || !overlayBlurHandler) return;
  try { overlay.removeListener('blur', overlayBlurHandler); } catch {}
  overlayBlurHandler = null;
}

function collapsePalette({ keepVisible = true } = {}) {
  const overlay = overlayWindow();
  expanded = false;
  if (!overlay || overlay.isDestroyed()) return;
  detachBlurHandler(overlay);
  const pos = positionFor(COMPACT_BOUNDS);
  overlay.setBounds({ ...pos, ...COMPACT_BOUNDS }, true);
  sendOverlayMode('compact');
  if (keepVisible) overlay.showInactive();
}

function expandPalette() {
  const overlay = overlayWindow();
  if (!overlay || overlay.isDestroyed()) {
    sendToMain('habitat:open-palette', { source: 'global-shortcut' }, { show: true });
    return;
  }
  expanded = true;
  detachBlurHandler(overlay);
  const pos = positionFor(PALETTE_BOUNDS);
  overlay.setBounds({ ...pos, ...PALETTE_BOUNDS }, true);
  overlay.show();
  overlay.focus();
  overlay.moveTop?.();
  sendOverlayMode('expanded');
  overlayBlurHandler = () => {
    setTimeout(() => {
      if (expanded && !overlay.isFocused()) collapsePalette();
    }, 120);
  };
  overlay.on('blur', overlayBlurHandler);
}

function togglePalette() {
  expanded ? collapsePalette() : expandPalette();
}

function toggleVoice(source = 'global-shortcut') {
  const delivered = sendToMain('habitat:voice-toggle', { source }, { show: false });
  if (!delivered) return;
  const overlay = overlayWindow();
  if (overlay && !overlay.isDestroyed()) {
    if (expanded) collapsePalette();
    else overlay.showInactive();
  }
}

function submitCommand(text, source = 'overlay') {
  const command = String(text || '').trim().slice(0, 8000);
  if (!command) return false;
  const delivered = sendToMain('habitat:command', { text: command, source }, { show: false });
  if (delivered) collapsePalette();
  return delivered;
}

function registerOne(candidates, callback) {
  for (const accelerator of candidates) {
    try {
      if (globalShortcut.register(accelerator, callback)) return accelerator;
    } catch {}
  }
  return '';
}

function registerGlobalShortcuts() {
  paletteShortcut = registerOne(PALETTE_SHORTCUTS, togglePalette);
  voiceShortcut = registerOne(VOICE_SHORTCUTS, () => toggleVoice('global-shortcut'));
  const overlay = overlayWindow();
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.once('did-finish-load', () => sendOverlayMode(expanded ? 'expanded' : 'compact'));
    if (!overlay.webContents.isLoading()) sendOverlayMode(expanded ? 'expanded' : 'compact');
  }
  console.log('[SEXTA Habitat] shortcuts', {
    palette: paletteShortcut || 'unavailable',
    voice: voiceShortcut || 'unavailable'
  });
}

function registerHabitatIpc() {
  ipcMain.on('habitat:toggle-palette', togglePalette);
  ipcMain.on('habitat:collapse', () => collapsePalette());
  ipcMain.on('habitat:voice-toggle', () => toggleVoice('overlay'));
  ipcMain.on('habitat:command', (_event, payload = {}) => submitCommand(payload.text, 'overlay'));
  ipcMain.on('habitat:open-main', () => {
    const win = mainWindow();
    if (!win || win.isDestroyed()) return;
    collapsePalette();
    win.show();
    win.focus();
  });
  ipcMain.handle('habitat:status', async () => ({
    ok: true,
    expanded,
    shortcuts: { palette: paletteShortcut, voice: voiceShortcut }
  }));
}

function keepLoginLaunchQuiet() {
  if (!app.getLoginItemSettings().wasOpenedAtLogin) return;
  const win = mainWindow();
  if (!win || win.isDestroyed()) return;
  const quiet = () => setTimeout(() => {
    try { if (!win.isDestroyed()) win.hide(); } catch {}
  }, 180);
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', quiet);
  else quiet();
}

app.whenReady().then(() => {
  registerHabitatIpc();
  registerGlobalShortcuts();
  setTimeout(keepLoginLaunchQuiet, 700);
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch {}
});

module.exports = {
  togglePalette,
  expandPalette,
  collapsePalette,
  toggleVoice,
  submitCommand,
  status: () => ({ expanded, paletteShortcut, voiceShortcut })
};
