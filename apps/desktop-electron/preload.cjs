const { contextBridge, ipcRenderer } = require('electron');

async function safeSystemStatus() {
  const status = await ipcRenderer.invoke('system:status');
  if (status?.agent?.diagnostics) {
    const { lastLog, ...safeDiagnostics } = status.agent.diagnostics;
    status.agent.diagnostics = safeDiagnostics;
  }
  return status;
}

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, detail) => callback(detail || {});
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('sextaDesktop', {
  platform: process.platform,
  desktop: true,
  version: '2.2.0',
  vault: {
    choose: () => ipcRenderer.invoke('vault:choose'),
    status: () => ipcRenderer.invoke('vault:status'),
    read: () => ipcRenderer.invoke('vault:read'),
    write: (notes) => ipcRenderer.invoke('vault:write', { notes }),
    open: () => ipcRenderer.invoke('vault:open')
  },
  presence: {
    update: detail => ipcRenderer.send('presence:update', detail || {}),
    onUpdate: callback => subscribe('presence:state', callback)
  },
  overlay: {
    open: () => ipcRenderer.send('overlay:open')
  },
  habitat: {
    togglePalette: () => ipcRenderer.send('habitat:toggle-palette'),
    collapse: () => ipcRenderer.send('habitat:collapse'),
    command: text => ipcRenderer.send('habitat:command', { text: String(text || '') }),
    toggleVoice: () => ipcRenderer.send('habitat:voice-toggle'),
    openMain: () => ipcRenderer.send('habitat:open-main'),
    status: () => ipcRenderer.invoke('habitat:status'),
    onMode: callback => subscribe('habitat:mode', callback),
    onCommand: callback => subscribe('habitat:command', callback),
    onVoiceToggle: callback => subscribe('habitat:voice-toggle', callback),
    onOpenPalette: callback => subscribe('habitat:open-palette', callback)
  },
  system: {
    status: safeSystemStatus,
    retryCloud: () => ipcRenderer.invoke('system:retry-cloud'),
    restartAgent: () => ipcRenderer.invoke('system:restart-agent'),
    setupAgent: () => ipcRenderer.invoke('system:setup-agent'),
    openAgentControl: () => ipcRenderer.invoke('system:open-agent-control'),
    pairAgent: (payload) => ipcRenderer.invoke('system:pair-agent', payload || {}),
    checkUpdates: () => ipcRenderer.invoke('system:check-updates')
  }
});
