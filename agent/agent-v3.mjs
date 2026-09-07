import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { browserBack, browserClick, browserOpen, browserSnapshot, browserStatus, browserType } from './browser-agent.mjs';
import { captureScreen, focusWindow, uiClickText, uiHotkey, uiScroll, uiTree, uiTypeText, windowList } from './windows-ui.mjs';
import { audit } from './audit.mjs';
import { AGENT_PROTOCOL_VERSION, evaluateLocalAction, publicRuntimeState, readRuntimeState, writeRuntimeState } from './runtime-state.mjs';

const BASE = (process.env.SEXTA_BASE_URL || 'https://seta-feira.vercel.app').replace(/\/$/, '');
const TOKEN = process.env.SEXTA_AGENT_TOKEN || 'local-agent-token';
const DEVICE_ID = process.env.SEXTA_DEVICE_ID || `windows-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
const configPath = process.env.SEXTA_AGENT_CONFIG || path.join(path.dirname(new URL(import.meta.url).pathname), 'config.json');
let cfg = { deviceName: os.hostname(), apps: {}, projects: {}, codex: {}, browser: {} };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch {}

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, 'X-SEXTA-Device-ID': DEVICE_ID };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const activeCodexProjects = new Set();
const activeChildren = new Set();

async function post(route, body) {
  const response = await fetch(`${BASE}${route}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response.json();
}

function trackChild(child) {
  activeChildren.add(child);
  const done = () => activeChildren.delete(child);
  child.once('close', done); child.once('error', done);
  return child;
}

function cancelActiveChildren() {
  let count = 0;
  for (const child of [...activeChildren]) {
    try { child.kill(); count += 1; } catch {}
  }
  return count;
}

function execDetached(command, args = []) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function execCapture(command, args = [], timeout = 8000) {
  return new Promise((resolve, reject) => {
    const child = trackChild(spawn(command, args, { windowsHide: true }));
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {}; reject(new Error('timeout')); }, timeout);
    child.stdout?.on('data', d => out += d);
    child.stderr?.on('data', d => err += d);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || `exit ${code}`)); });
  });
}

function execCaptureLong(command, args = [], { timeout = 15 * 60 * 1000, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32' && !/\.exe$/i.test(String(command || ''));
    const child = trackChild(spawn(command, args, { windowsHide: true, shell: useShell }));
    let out = '', err = '', settled = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-200000);
    const keepAlive = setInterval(() => void heartbeat().catch(() => {}), 12000);
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      if (!settled) { settled = true; clearInterval(keepAlive); reject(new Error('CODEX_TIMEOUT')); }
    }, timeout);
    child.stdout?.on('data', d => { out = append(out, d); });
    child.stderr?.on('data', d => { err = append(err, d); });
    child.on('error', error => {
      if (settled) return; settled = true; clearTimeout(timer); clearInterval(keepAlive); reject(error);
    });
    child.on('close', code => {
      if (settled) return; settled = true; clearTimeout(timer); clearInterval(keepAlive);
      code === 0 ? resolve({ out: out.trim(), err: err.trim() }) : reject(new Error(err.trim() || out.trim() || `codex exit ${code}`));
    });
    if (child.stdin) child.stdin.end(String(input || ''), 'utf8');
  });
}

function projectPath(name = '') {
  const key = String(name || '').trim();
  const value = cfg.projects?.[key];
  if (!value) throw new Error('Projeto não está na allowlist local');
  return { key, value: path.resolve(String(value)) };
}

async function runCodexTask(payload = {}) {
  const state = readRuntimeState();
  if (state.paused) throw new Error('AGENT_PAUSED');
  if (state.autonomy === 'observer') throw new Error('AUTONOMY_OBSERVER_READ_ONLY');
  if (payload?._sextaAgentTask === true && state.autonomy !== 'autonomous') throw new Error('AUTONOMOUS_MODE_REQUIRED');

  const { key: project, value: cwd } = projectPath(payload.project);
  const task = String(payload.task || '').replace(/\s+/g, ' ').trim().slice(0, 12000);
  if (task.length < 4) throw new Error('Tarefa do Codex vazia');
  if (!fs.existsSync(cwd)) throw new Error('Pasta do projeto não encontrada');
  const mode = payload.mode === 'edit' ? 'edit' : 'analyze';
  const sandbox = mode === 'edit' ? 'workspace-write' : 'read-only';
  const codexCommand = String(cfg.codex?.command || 'codex').trim() || 'codex';
  const timeout = Math.max(60000, Math.min(30 * 60 * 1000, Number(cfg.codex?.timeoutMs || 15 * 60 * 1000)));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sexta-codex-'));
  const outputFile = path.join(tempDir, 'last-message.txt');
  const prompt = [
    'Você foi acionado pela assistente pessoal SEXTA-feira para trabalhar neste projeto.',
    mode === 'edit' ? 'Edite somente este workspace, preserve funcionalidades e rode verificações locais seguras.' : 'Modo análise: não altere arquivos.',
    'Não tente acessar outras pastas do computador nem remover sandbox/aprovações.',
    `Tarefa: ${task}`
  ].join('\n\n');
  const args = ['exec', '--ephemeral', '--sandbox', sandbox, '--ask-for-approval', 'never', '--cd', cwd, '--output-last-message', outputFile, '-'];
  try {
    const execution = await execCaptureLong(codexCommand, args, { timeout, input: prompt });
    let summary = '';
    try { summary = fs.readFileSync(outputFile, 'utf8').trim(); } catch {}
    if (!summary) summary = execution.out || execution.err || 'Codex concluiu sem mensagem final.';
    const gitStatus = await execCapture('git', ['-C', cwd, 'status', '--short'], 10000).catch(() => '');
    return { kind: 'codex_task', project, mode, sandbox, summary: String(summary).slice(0, 14000), gitStatus: String(gitStatus || '').slice(0, 8000) };
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

async function launchCodexTask(command) {
  const payload = command.payload || {};
  const project = String(payload.project || '').trim();
  if (!project) throw new Error('Projeto do Codex não informado');
  if (activeCodexProjects.has(project)) throw new Error(`CODEX_PROJECT_BUSY: ${project}`);
  projectPath(project);
  activeCodexProjects.add(project);
  await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: 'codex_task', status: 'running', ok: true, result: { project, mode: payload.mode === 'edit' ? 'edit' : 'analyze' }, message: `Codex trabalhando em ${project}.` });
  audit({ commandId: command.id, action: 'codex_task', status: 'running', ok: true, details: { project, mode: payload.mode } });
  void runCodexTask(payload)
    .then(result => post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: 'codex_task', status: 'done', ok: true, result, message: `Tarefa do Codex concluída em ${project}.` }))
    .then(() => audit({ commandId: command.id, action: 'codex_task', status: 'done', ok: true, details: { project } }))
    .catch(error => post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: 'codex_task', status: 'failed', ok: false, result: {}, message: String(error?.message || error).slice(0, 1200) }).catch(() => {}))
    .finally(() => activeCodexProjects.delete(project));
}

function handleControl(payload = {}) {
  const op = String(payload.op || '');
  if (op === 'pause') return writeRuntimeState({ paused: true });
  if (op === 'resume') return writeRuntimeState({ paused: false });
  if (op === 'set_autonomy') return writeRuntimeState({ autonomy: payload.value });
  if (op === 'set_privacy') return writeRuntimeState({ privacy: payload.value || {} });
  if (op === 'cancel') {
    const current = readRuntimeState();
    const killed = cancelActiveChildren();
    const next = writeRuntimeState({ cancelEpoch: current.cancelEpoch + 1 });
    return { ...next, killedProcesses: killed };
  }
  throw new Error('AGENT_CONTROL_INVALID');
}

async function execute(command) {
  const { action, payload = {} } = command;
  if (action === 'agent_control') return { control: true, state: publicRuntimeState(handleControl(payload)) };
  const localPolicy = evaluateLocalAction(action, payload);
  if (!localPolicy.allowed) throw new Error(localPolicy.reason);

  if (action === 'open_url') {
    const url = new URL(String(payload.url || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL bloqueada');
    if (process.platform === 'win32') execDetached('cmd', ['/c', 'start', '', url.toString()]); else execDetached('xdg-open', [url.toString()]);
    return { opened: url.toString() };
  }
  if (action === 'open_app') {
    const app = cfg.apps?.[String(payload.app || '')];
    if (!app?.command) throw new Error('Aplicativo não está na allowlist local');
    execDetached(app.command, Array.isArray(app.args) ? app.args : []); return { app: payload.app };
  }
  if (action === 'open_project') { const project = projectPath(payload.project); execDetached('code', [project.value]); return { project: project.key, path: project.value }; }
  if (action === 'git_status') {
    const names = Object.keys(cfg.projects || {}); const requested = payload.project && cfg.projects[payload.project] ? payload.project : names[0];
    if (!requested) throw new Error('Nenhum projeto configurado');
    const output = await execCapture('git', ['-C', cfg.projects[requested], 'status', '--short']); return { project: requested, clean: !output, output };
  }
  if (action === 'get_system_info') return { hostname: os.hostname(), platform: os.platform(), release: os.release(), uptimeSeconds: Math.round(os.uptime()), freeMemoryMB: Math.round(os.freemem() / 1024 / 1024), totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024), runtime: publicRuntimeState() };
  if (action === 'read_clipboard') { const text = await execCapture('powershell.exe', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], 5000); return { text: String(text || '').slice(0, 20000) }; }
  if (action === 'copy_text') {
    const value = String(payload.text || '').slice(0, 20000);
    await new Promise((resolve, reject) => { const child = trackChild(spawn('clip.exe', [], { windowsHide: true })); child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`clip exit ${code}`))); child.stdin.end(value, 'utf8'); });
    return { copied: true, length: value.length };
  }
  if (action === 'window_list') return windowList(payload.limit);
  if (action === 'window_focus') return focusWindow(payload.title);
  if (action === 'ui_tree') return uiTree(payload.maxNodes);
  if (action === 'ui_click_text') return uiClickText(payload.text);
  if (action === 'ui_type_text') return uiTypeText(payload.text, payload.target);
  if (action === 'ui_scroll') return uiScroll(payload.direction, payload.amount);
  if (action === 'ui_hotkey') return uiHotkey(payload.shortcut);
  if (action === 'screen_analyze') {
    const shot = await captureScreen(payload.scope === 'all' ? 'all' : 'primary');
    const vision = await post('/api/pc-vision-analyze', { deviceId: DEVICE_ID, imageBase64: shot.imageBase64, question: payload.question || '', scope: shot.scope });
    return { screenshot: { width: shot.width, height: shot.height, scope: shot.scope, bytes: shot.bytes }, analysis: vision.analysis || {}, model: vision.model || '' };
  }
  if (action === 'browser_open') return browserOpen(cfg, payload.url);
  if (action === 'browser_snapshot') return browserSnapshot(cfg);
  if (action === 'browser_click') return browserClick(cfg, payload.index);
  if (action === 'browser_type') return browserType(cfg, payload.index, payload.text);
  if (action === 'browser_back') return browserBack(cfg);
  throw new Error('Ação não permitida');
}

const CAPABILITIES = [
  'open_url', 'open_app', 'open_project', 'git_status', 'get_system_info', 'read_clipboard', 'copy_text', 'codex_task',
  'window_list', 'window_focus', 'ui_tree', 'ui_click_text', 'ui_type_text', 'ui_scroll', 'ui_hotkey', 'screen_analyze',
  'browser_open', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_back', 'agent_control'
];

async function heartbeat() {
  const runtime = publicRuntimeState();
  return post('/api/device-heartbeat', {
    deviceId: DEVICE_ID, name: cfg.deviceName || os.hostname(), kind: 'agent', capabilities: CAPABILITIES,
    context: {
      hostname: os.hostname(), platform: os.platform(), uptime: Math.round(os.uptime()), projects: Object.keys(cfg.projects || {}),
      codexTask: true, pcAgent: true, pcVision: process.platform === 'win32', pcHands: process.platform === 'win32',
      browserAgent: browserStatus(cfg), codexActiveProjects: [...activeCodexProjects], agentProtocol: AGENT_PROTOCOL_VERSION,
      agentVersion: AGENT_PROTOCOL_VERSION, autonomy: runtime.autonomy, paused: runtime.paused, privacy: runtime.privacy
    }
  });
}

async function poll() {
  const response = await fetch(`${BASE}/api/agent-poll?deviceId=${encodeURIComponent(DEVICE_ID)}`, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`poll: ${response.status} ${await response.text()}`);
  return response.json();
}

console.log(`[SEXTA Agent v${AGENT_PROTOCOL_VERSION}] ${DEVICE_ID} -> ${BASE}`);
let lastBeat = 0;
while (true) {
  try {
    if (Date.now() - lastBeat > 15000) { await heartbeat(); lastBeat = Date.now(); }
    const { commands = [] } = await poll();
    for (const command of commands) {
      if (command.payload?.codexTask === true) {
        try { await launchCodexTask(command); }
        catch (error) {
          audit({ commandId: command.id, action: 'codex_task', status: 'failed', ok: false, details: { message: error.message } });
          await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: 'codex_task', status: 'failed', ok: false, result: {}, message: String(error?.message || error).slice(0, 1200) }).catch(() => {});
        }
        continue;
      }
      try {
        audit({ commandId: command.id, action: command.action, status: 'running', ok: true });
        const result = await execute(command);
        audit({ commandId: command.id, action: command.action, status: 'done', ok: true, details: { state: publicRuntimeState() } });
        await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: command.action, status: 'done', ok: true, result, message: 'Executado pelo agente Windows.' });
        if (command.action === 'agent_control') lastBeat = 0;
      } catch (error) {
        audit({ commandId: command.id, action: command.action, status: 'failed', ok: false, details: { message: error.message } });
        await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: command.action, status: 'failed', ok: false, result: { error: error.message }, message: error.message });
      }
    }
  } catch (error) { console.error('[SEXTA Agent]', error.message); }
  await sleep(3000);
}
