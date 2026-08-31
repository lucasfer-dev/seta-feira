import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import health from './api/health.js';
import login from './api/login.js';
import chat from './api/chat.js';
import tts from './api/tts.js';
import liveToken from './api/live-token.js';
import liveTurn from './api/live-turn.js';
import sync from './api/sync.js';
import memory from './api/memory.js';
import settings from './api/settings.js';
import heartbeat from './api/device-heartbeat.js';
import commands from './api/commands.js';
import agentPoll from './api/agent-poll.js';
import agentResult from './api/agent-result.js';
import androidPoll from './api/android-poll.js';
import androidResult from './api/android-result.js';
import voiceAction from './api/voice-action.js';
import toolExecute from './api/tool-execute.js';
import googleStatusRoute from './api/google/status.js';
import googleAuthUrl from './api/google/auth-url.js';
import googleCallback from './api/google/callback.js';
import googleAction from './api/google/action.js';
import importResponse from './api/import-response.js';
import commandStatus from './api/command-status.js';
import evolutionStatusRoute from './api/evolution/status.js';
import evolutionConfigureWebhook from './api/evolution/configure-webhook.js';
import evolutionSend from './api/evolution/send.js';
import evolutionWebhook from './api/evolution/webhook.js';
import notificationsRoute from './api/notifications/index.js';
import notificationAction from './api/notifications/action.js';
import monitorRun from './api/monitor/run.js';
import pushRegister from './api/push/register.js';
import vault from './api/vault.js';
import { runMonitor } from './lib/monitor.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const routes = new Map([
  ['/api/health', health], ['/api/login', login], ['/api/chat', chat], ['/api/tts', tts],
  ['/api/live-token', liveToken], ['/api/live-turn', liveTurn], ['/api/sync', sync],
  ['/api/memory', memory], ['/api/settings', settings], ['/api/device-heartbeat', heartbeat],
  ['/api/commands', commands], ['/api/agent-poll', agentPoll], ['/api/agent-result', agentResult],
  ['/api/android-poll', androidPoll], ['/api/android-result', androidResult], ['/api/voice-action', voiceAction], ['/api/tool-execute', toolExecute],
  ['/api/google/status', googleStatusRoute], ['/api/google/auth-url', googleAuthUrl],
  ['/api/google/callback', googleCallback], ['/api/google/action', googleAction], ['/api/import-response', importResponse], ['/api/command-status', commandStatus],
  ['/api/evolution/status', evolutionStatusRoute], ['/api/evolution/configure-webhook', evolutionConfigureWebhook], ['/api/evolution/send', evolutionSend], ['/api/evolution/webhook', evolutionWebhook],
  ['/api/notifications', notificationsRoute], ['/api/notifications/action', notificationAction], ['/api/monitor/run', monitorRun], ['/api/push/register', pushRegister], ['/api/vault', vault]
]);

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const handler = routes.get(url.pathname);
    if (handler) return handler(req, res);

    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const safe = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const file = join(root, safe);
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end('Forbidden'); }
    const data = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    if (pathname === '/service-worker.js') res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        const data = await readFile(join(root, 'index.html'));
        res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(data);
      } catch {}
    }
    console.error(error);
    res.statusCode = 500; res.end('Internal Server Error');
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`SEXTA 1.3 em http://localhost:${port}`);
  if (process.env.SEXTA_MONITOR_ENABLED !== 'false') {
    const interval = Math.max(30, Number(process.env.SEXTA_MONITOR_INTERVAL_SECONDS || 60)) * 1000;
    const tick = () => runMonitor().catch(error => console.warn('[SEXTA Monitor]', error.message));
    setTimeout(tick, 5000);
    setInterval(tick, interval);
  }
});