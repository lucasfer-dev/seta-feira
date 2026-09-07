const { app, shell, session } = require('electron');

const WEB_URL = process.env.SEXTA_WEB_URL || 'https://seta-feira.vercel.app';
const TRUSTED_ORIGIN = new URL(WEB_URL).origin;

function trusted(url = '') {
  try {
    const parsed = new URL(url);
    return parsed.origin === TRUSTED_ORIGIN || parsed.protocol === 'file:';
  } catch { return false; }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (trusted(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
  contents.on('will-redirect', (event, url) => {
    if (trusted(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const sameOrigin = trusted(requestingOrigin || webContents?.getURL?.() || '');
    return sameOrigin && ['media', 'notifications'].includes(permission);
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const origin = details?.requestingUrl || webContents?.getURL?.() || '';
    callback(trusted(origin) && ['media', 'notifications'].includes(permission));
  });
});

require('./main.cjs');
