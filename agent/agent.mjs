import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE = (process.env.SEXTA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.SEXTA_AGENT_TOKEN || 'local-agent-token';
const DEVICE_ID = process.env.SEXTA_DEVICE_ID || `windows-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
const configPath = process.env.SEXTA_AGENT_CONFIG || path.join(path.dirname(new URL(import.meta.url).pathname), 'config.json');
let cfg = { deviceName: os.hostname(), apps: {}, projects: {} };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch {}

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(route, body) {
  const r = await fetch(`${BASE}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${route}: ${r.status} ${await r.text()}`);
  return r.json();
}

function execDetached(command, args = []) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function execCapture(command, args = [], timeout = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, timeout);
    child.stdout?.on('data', d => out += d);
    child.stderr?.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)); });
  });
}

async function execute(command) {
  const { action, payload = {} } = command;
  if (action === 'open_url') {
    const url = new URL(String(payload.url || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL bloqueada');
    if (process.platform === 'win32') execDetached('cmd', ['/c', 'start', '', url.toString()]);
    else execDetached('xdg-open', [url.toString()]);
    return { opened: url.toString() };
  }
  if (action === 'open_app') {
    const app = cfg.apps?.[String(payload.app || '')];
    if (!app?.command) throw new Error('Aplicativo não está na allowlist local');
    execDetached(app.command, Array.isArray(app.args) ? app.args : []);
    return { app: payload.app };
  }
  if (action === 'open_project') {
    const projectPath = cfg.projects?.[String(payload.project || '')];
    if (!projectPath) throw new Error('Projeto não está na allowlist local');
    execDetached('code', [projectPath]);
    return { project: payload.project, path: projectPath };
  }
  if (action === 'git_status') {
    const names = Object.keys(cfg.projects || {});
    const requested = payload.project && cfg.projects[payload.project] ? payload.project : names[0];
    if (!requested) throw new Error('Nenhum projeto configurado');
    const p = cfg.projects[requested];
    const output = await execCapture('git', ['-C', p, 'status', '--short']);
    return { project: requested, clean: !output, output };
  }
  if (action === 'get_system_info') {
    return {
      hostname: os.hostname(), platform: os.platform(), release: os.release(),
      uptimeSeconds: Math.round(os.uptime()), freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
      totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024)
    };
  }
  if (action === 'read_clipboard') {
    if (process.platform !== 'win32') throw new Error('Clipboard remoto disponível apenas no Windows nesta build');
    const text = await execCapture('powershell.exe', ['-NoProfile','-Command','Get-Clipboard -Raw'], 5000);
    return { text: String(text || '').slice(0, 20000) };
  }
  if (action === 'copy_text') {
    if (process.platform !== 'win32') throw new Error('Clipboard remoto disponível apenas no Windows nesta build');
    const value = String(payload.text || '').slice(0, 20000);
    await new Promise((resolve,reject)=>{
      const child=spawn('clip.exe',[],{windowsHide:true});
      child.on('error',reject); child.on('close',code=>code===0?resolve():reject(new Error(`clip exit ${code}`)));
      child.stdin.end(value,'utf8');
    });
    return { copied:true, length:value.length };
  }
  throw new Error('Ação não permitida');
}

async function heartbeat() {
  return post('/api/device-heartbeat', {
    deviceId: DEVICE_ID, name: cfg.deviceName || os.hostname(), kind: 'agent',
    capabilities: ['open_url','open_app','open_project','git_status','get_system_info','read_clipboard','copy_text'],
    context: { hostname: os.hostname(), platform: os.platform(), uptime: Math.round(os.uptime()), projects: Object.keys(cfg.projects || {}) }
  });
}

async function poll() {
  const r = await fetch(`${BASE}/api/agent-poll?deviceId=${encodeURIComponent(DEVICE_ID)}`, { headers });
  if (!r.ok) throw new Error(`poll: ${r.status} ${await r.text()}`);
  return r.json();
}

console.log(`[SEXTA Agent] ${DEVICE_ID} -> ${BASE}`);
let lastBeat = 0;
while (true) {
  try {
    if (Date.now() - lastBeat > 15000) { await heartbeat(); lastBeat = Date.now(); }
    const { commands = [] } = await poll();
    for (const command of commands) {
      try {
        const result = await execute(command);
        await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: command.action, ok: true, result, message: 'Executado pelo agente Windows.' });
      } catch (error) {
        await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: command.action, ok: false, result: {}, message: error.message });
      }
    }
  } catch (error) {
    console.error('[SEXTA Agent]', error.message);
  }
  await sleep(3000);
}
