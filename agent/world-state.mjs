import { browserStatus, browserTabs } from './browser-agent.mjs';
import { listWindows } from './windows-control-v2.mjs';

export const WORLD_STATE_VERSION = '1.0.0';

function compactWindow(item = {}) {
  return {
    hwnd: Number(item.hwnd || item.handle || 0) || 0,
    title: String(item.title || item.name || '').slice(0, 180),
    process: String(item.process || item.processName || item.exe || '').slice(0, 100),
    active: item.active === true || item.foreground === true || item.isForeground === true,
    minimized: item.minimized === true || item.isMinimized === true,
    maximized: item.maximized === true || item.isMaximized === true
  };
}

function compactTab(item = {}, index = 0) {
  return {
    index: Number.isFinite(Number(item.index)) ? Number(item.index) : index,
    title: String(item.title || '').slice(0, 180),
    url: String(item.url || '').slice(0, 700),
    selected: item.selected === true || item.active === true
  };
}

export async function collectWorldState(cfg = {}, runtime = {}) {
  const capturedAt = new Date().toISOString();
  let windows = [];
  let tabs = [];
  let windowError = '';
  let browserError = '';

  if (process.platform === 'win32' && runtime?.privacy?.uiAutomation !== false) {
    try {
      const result = await listWindows(16);
      const source = Array.isArray(result) ? result : Array.isArray(result?.windows) ? result.windows : [];
      windows = source.map(compactWindow).filter(item => item.title || item.process).slice(0, 16);
    } catch (error) {
      windowError = String(error?.message || error).slice(0, 240);
    }
  }

  if (runtime?.privacy?.browser !== false) {
    try {
      const status = browserStatus(cfg);
      if (status?.available !== false) {
        const result = await browserTabs(cfg);
        const source = Array.isArray(result) ? result : Array.isArray(result?.tabs) ? result.tabs : [];
        tabs = source.map(compactTab).slice(0, 12);
      }
    } catch (error) {
      browserError = String(error?.message || error).slice(0, 240);
    }
  }

  const activeWindow = windows.find(item => item.active) || windows[0] || null;
  const activeTab = tabs.find(item => item.selected) || null;
  return {
    version: WORLD_STATE_VERSION,
    capturedAt,
    activeWindow,
    activeTab,
    windows,
    tabs,
    errors: {
      ...(windowError ? { windows: windowError } : {}),
      ...(browserError ? { browser: browserError } : {})
    }
  };
}
