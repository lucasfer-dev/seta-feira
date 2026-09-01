import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const BASE = (process.env.SEXTA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.SEXTA_AGENT_TOKEN || 'local-agent-token';
const DEVICE_ID = process.env.SEXTA_DEVICE_ID || `windows-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
const configPath = process.env.SEXTA_AGENT_CONFIG || path.join(path.dirname(new URL(import.meta.url).pathname), 'config.json');
let cfg = { deviceName: os.hostname(), apps: {}, projects: {}, codex: {} };
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) }; } catch {}

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const activeCodexProjects = new Set();

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

function execCaptureLong(command, args = [], { timeout = 15 * 60 * 1000, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === 'win32' && !/\.exe$/i.test(String(command || ''));
    const child = spawn(command, args, { windowsHide: true, shell: useShell });
    let out = '', err = '';
    let settled = false;
    const append = (current, chunk) => `${current}${chunk}`.slice(-200000);
    const keepAlive = setInterval(() => { void heartbeat().catch(() => {}); }, 12000);
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      if (!settled) {
        settled = true;
        clearInterval(keepAlive);
        reject(new Error('CODEX_TIMEOUT'));
      }
    }, timeout);
    child.stdout?.on('data', d => { out = append(out, d); });
    child.stderr?.on('data', d => { err = append(err, d); });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(keepAlive);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(keepAlive);
      if (code === 0) resolve({ out: out.trim(), err: err.trim() });
      else reject(new Error(err.trim() || out.trim() || `codex exit ${code}`));
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
  const { key: project, value: cwd } = projectPath(payload.project);
  const task = String(payload.task || '').replace(/\s+/g, ' ').trim().slice(0, 12000);
  if (task.length < 4) throw new Error('Tarefa do Codex vazia');
  if (!fs.existsSync(cwd)) throw new Error('Pasta do projeto não encontrada');

  const mode = payload.mode === 'edit' ? 'edit' : 'analyze';
  const sandbox = mode === 'edit' ? 'workspace-write' : 'read-only';
  const codexCommand = String(cfg.codex?.command || 'codex').trim() || 'codex';
  const configuredTimeout = Number(cfg.codex?.timeoutMs || 15 * 60 * 1000);
  const timeout = Math.max(60000, Math.min(30 * 60 * 1000, configuredTimeout));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sexta-codex-'));
  const outputFile = path.join(tempDir, 'last-message.txt');

  const prompt = [
    'Você foi acionado pela assistente pessoal SEXTA-feira para trabalhar neste projeto.',
    mode === 'edit'
      ? 'Você pode analisar e editar somente este workspace. Faça mudanças objetivas, preserve funcionalidades e rode verificações locais que não exijam sair do sandbox.'
      : 'Modo análise: não altere arquivos. Inspecione o projeto e responda com diagnóstico e próximos passos objetivos.',
    'Não tente acessar outras pastas do computador. Não use opções para remover sandbox ou aprovações.',
    `Tarefa: ${task}`
  ].join('\n\n');

  const args = [
    'exec',
    '--ephemeral',
    '--sandbox', sandbox,
    '--ask-for-approval', 'never',
    '--cd', cwd,
    '--output-last-message', outputFile,
    '-'
  ];

  try {
    const execution = await execCaptureLong(codexCommand, args, { timeout, input: prompt });
    let summary = '';
    try { summary = fs.readFileSync(outputFile, 'utf8').trim(); } catch {}
    if (!summary) summary = execution.out || execution.err || 'Codex concluiu sem mensagem final.';
    const gitStatus = await execCapture('git', ['-C', cwd, 'status', '--short'], 10000).catch(() => '');
    return {
      kind: 'codex_task', project, mode, sandbox,
      summary: String(summary).slice(0, 14000),
      gitStatus: String(gitStatus || '').slice(0, 8000)
    };
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
  try {
    await post('/api/agent-result', {
      commandId: command.id,
      deviceId: DEVICE_ID,
      action: 'codex_task',
      status: 'running',
      ok: true,
      result: { project, mode: payload.mode === 'edit' ? 'edit' : 'analyze' },
      message: `Codex trabalhando em ${project}.`
    });
  } catch (error) {
    activeCodexProjects.delete(project);
    throw error;
  }

  void runCodexTask(payload)
    .then(result => post('/api/agent-result', {
      commandId: command.id,
      deviceId: DEVICE_ID,
      action: 'codex_task',
      status: 'done',
      ok: true,
      result,
      message: `Tarefa do Codex concluída em ${project}.`
    }))
    .catch(error => post('/api/agent-result', {
      commandId: command.id,
      deviceId: DEVICE_ID,
      action: 'codex_task',
      status: 'failed',
      ok: false,
      result: {},
      message: String(error?.message || error).slice(0, 1200)
    }).catch(() => {}))
    .finally(() => activeCodexProjects.delete(project));
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
    const project = projectPath(payload.project);
    execDetached('code', [project.value]);
    return { project: project.key, path: project.value };
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
    capabilities: ['open_url','open_app','open_project','git_status','get_system_info','read_clipboard','copy_text','codex_task'],
    context: {
      hostname: os.hostname(), platform: os.platform(), uptime: Math.round(os.uptime()),
      projects: Object.keys(cfg.projects || {}), codexTask: true,
      codexActiveProjects: [...activeCodexProjects]
    }
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
      if (command.payload?.codexTask === true) {
        try {
          await launchCodexTask(command);
        } catch (error) {
          await post('/api/agent-result', {
            commandId: command.id,
            deviceId: DEVICE_ID,
            action: 'codex_task',
            status: 'failed',
            ok: false,
            result: {},
            message: String(error?.message || error).slice(0, 1200)
          }).catch(() => {});
        }
        continue;
      }

      try {
        const result = await execute(command);
        await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: command.action, status: 'done', ok: true, result, message: 'Executado pelo agente Windows.' });
      } catch (error) {
        await post('/api/agent-result', { commandId: command.id, deviceId: DEVICE_ID, action: command.action, status: 'failed', ok: false, result: {}, message: error.message });
      }
    }
  } catch (error) {
    console.error('[SEXTA Agent]', error.message);
  }
  await sleep(3000);
}
