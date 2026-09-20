const DEFAULTS = {
  browser: ['voice', 'text', 'notifications'],
  desktop: ['voice', 'text', 'notifications', 'filesystem', 'coding', 'browser_automation', 'windows', 'obsidian', 'screen'],
  windows: ['voice', 'text', 'notifications', 'filesystem', 'coding', 'browser_automation', 'windows', 'obsidian', 'screen'],
  android: ['voice', 'text', 'notifications', 'camera', 'location', 'android_actions'],
  agent: ['filesystem', 'coding', 'browser_automation', 'windows', 'obsidian', 'screen']
};

export function normalizeCapabilities(kind, capabilities = []) {
  const base = DEFAULTS[String(kind || '').toLowerCase()] || [];
  return [...new Set([...base, ...(Array.isArray(capabilities) ? capabilities : [])])].sort();
}

export function deviceCan(device, capability) {
  return Boolean(device && normalizeCapabilities(device.kind, device.capabilities).includes(capability));
}

export function chooseDevice(devices = [], capability, preferredId = null) {
  const online = devices.filter(d => d?.online !== false);
  if (preferredId) {
    const preferred = online.find(d => d.id === preferredId && deviceCan(d, capability));
    if (preferred) return preferred;
  }
  return online.find(d => deviceCan(d, capability)) || null;
}

export function inferRequiredCapability(toolName = '') {
  if (toolName.startsWith('pc.') || toolName.startsWith('windows.')) return 'windows';
  if (toolName.startsWith('browser.')) return 'browser_automation';
  if (toolName.startsWith('coding.') || toolName.startsWith('codex.')) return 'coding';
  if (toolName.startsWith('obsidian.') || toolName.startsWith('vault.')) return 'obsidian';
  if (toolName.startsWith('android.')) return 'android_actions';
  return null;
}
