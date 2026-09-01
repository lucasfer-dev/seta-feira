const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sextaDesktop', {
  platform: process.platform,
  desktop: true,
  version: '1.5.0',
  vault: {
    choose: () => ipcRenderer.invoke('vault:choose'),
    status: () => ipcRenderer.invoke('vault:status'),
    read: () => ipcRenderer.invoke('vault:read'),
    write: (notes) => ipcRenderer.invoke('vault:write', { notes }),
    open: () => ipcRenderer.invoke('vault:open')
  }
});
