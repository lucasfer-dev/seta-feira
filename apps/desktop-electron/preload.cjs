const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sextaDesktop', {
  platform: process.platform,
  desktop: true,
  version: '2.0.0',
  vault: {
    choose: () => ipcRenderer.invoke('vault:choose'),
    status: () => ipcRenderer.invoke('vault:status'),
    read: () => ipcRenderer.invoke('vault:read'),
    write: (notes) => ipcRenderer.invoke('vault:write', { notes }),
    open: () => ipcRenderer.invoke('vault:open')
  },
  presence: {
    update: detail => ipcRenderer.send('presence:update', detail || {}),
    onUpdate: callback => {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, detail) => callback(detail || {});
      ipcRenderer.on('presence:state', listener);
      return () => ipcRenderer.removeListener('presence:state', listener);
    }
  },
  overlay: {
    open: () => ipcRenderer.send('overlay:open')
  }
});
