import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AGENT_PROTOCOL_VERSION, readRuntimeState } from './runtime-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = path.join(ROOT, '.env.local');
const CONFIG_PATH = path.join(ROOT, 'agent', 'config.json');

function envFile() {
  const map = {};
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (match) map[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {}
  return map;
}

function commandExists(name) {
  const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? String(result.stdout || '').trim().split(/\r?\n/)[0] : '';
}

function powershell(script) {
  if (process.platform !== 'win32') return { ok: false, message: 'Windows necessário' };
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  return { ok: r.status === 0, message: String(r.stderr || r.stdout || '').trim() };
}

function row(name, ok, detail = '', required = true) { return { name, ok: Boolean(ok), detail: String(detail || ''), required }; }

export async function runDoctor({ print = true } = {}) {
  const rows = [];
  const env = { ...envFile(), ...process.env };
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

  rows.push(row('Windows', process.platform === 'win32', `${os.platform()} ${os.release()}`));
  rows.push(row('Node 22+', Number(process.versions.node.split('.')[0]) >= 22, `v${process.versions.node}`));
  rows.push(row('config.json', Boolean(cfg && Object.keys(cfg).length), CONFIG_PATH));
  rows.push(row('Token pareado', Boolean(env.SEXTA_AGENT_TOKEN), env.SEXTA_AGENT_TOKEN ? 'presente' : 'ausente'));
  rows.push(row('Device ID', Boolean(env.SEXTA_DEVICE_ID), env.SEXTA_DEVICE_ID || 'ausente'));

  const code = commandExists('code');
  const codex = commandExists('codex');
  rows.push(row('VS Code', Boolean(code), code || 'não encontrado', false));
  rows.push(row('Codex CLI', Boolean(codex), codex || 'não encontrado; recursos de código ficam opcionais', false));

  const ui = powershell("Add-Type -AssemblyName UIAutomationClient; Add-Type -AssemblyName UIAutomationTypes; [System.Windows.Automation.AutomationElement]::RootElement | Out-Null");
  rows.push(row('Windows UI Automation', ui.ok, ui.ok ? 'assemblies carregadas' : ui.message));
  const drawing = powershell("Add-Type -AssemblyName System.Drawing; [System.Drawing.Bitmap]::new(2,2).Dispose()");
  rows.push(row('Captura de tela', drawing.ok, drawing.ok ? 'System.Drawing disponível' : drawing.message));
  const clipboard = powershell("Get-Command Get-Clipboard | Out-Null; Get-Command Set-Clipboard | Out-Null");
  rows.push(row('Clipboard', clipboard.ok, clipboard.ok ? 'PowerShell clipboard disponível' : clipboard.message));

  const browserConfigured = String(cfg.browser?.command || '').trim();
  const browserCandidates = [
    browserConfigured,
    process.env['PROGRAMFILES(X86)'] ? path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
    commandExists('msedge'), commandExists('chrome')
  ].filter(Boolean);
  const browser = browserCandidates.find(candidate => fs.existsSync(candidate) || (!path.isAbsolute(candidate) && commandExists(candidate)));
  rows.push(row('Browser Agent', Boolean(browser), browser || 'Edge/Chrome não encontrado'));

  const projects = Object.entries(cfg.projects || {});
  const missingProjects = projects.filter(([, value]) => !fs.existsSync(String(value))).map(([key]) => key);
  rows.push(row('Projetos allowlist', missingProjects.length === 0, projects.length ? `${projects.length} configurado(s)${missingProjects.length ? `; ausentes: ${missingProjects.join(', ')}` : ''}` : 'nenhum projeto configurado', false));

  const state = readRuntimeState();
  rows.push(row('Runtime state', true, `${state.autonomy}${state.paused ? ' • pausado' : ''} • privacy ${Object.values(state.privacy).every(Boolean) ? 'on' : 'custom'}`, false));

  const base = String(env.SEXTA_BASE_URL || 'https://seta-feira.vercel.app').replace(/\/$/, '');
  const started = Date.now();
  try {
    const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(8000) });
    rows.push(row('SEXTA Cloud', health.ok, health.ok ? `${Date.now() - started} ms` : `HTTP ${health.status}`));
  } catch (error) { rows.push(row('SEXTA Cloud', false, String(error?.message || error))); }

  if (env.SEXTA_AGENT_TOKEN && env.SEXTA_DEVICE_ID) {
    const startedAuth = Date.now();
    try {
      const response = await fetch(`${base}/api/agent-check`, {
        headers: { Authorization: `Bearer ${env.SEXTA_AGENT_TOKEN}`, 'X-SEXTA-Device-ID': env.SEXTA_DEVICE_ID },
        signal: AbortSignal.timeout(8000)
      });
      const data = await response.json().catch(() => ({}));
      rows.push(row('Autenticação do agente', response.ok, response.ok ? `${data.tokenType || 'agent'} • ${Date.now() - startedAuth} ms` : `HTTP ${response.status}`));
    } catch (error) { rows.push(row('Autenticação do agente', false, String(error?.message || error))); }
  }

  const required = rows.filter(r => r.required);
  const passed = required.filter(r => r.ok).length;
  const optionalWarnings = rows.filter(r => !r.required && !r.ok).length;
  const result = { ok: passed === required.length, protocol: AGENT_PROTOCOL_VERSION, passed, required: required.length, optionalWarnings, rows };

  if (print) {
    console.log('\nSEXTA DOCTOR // PC READINESS\n');
    for (const item of rows) console.log(`${item.ok ? '✓' : item.required ? '✕' : '△'} ${item.name.padEnd(24)} ${item.detail}`);
    console.log(`\n${result.ok ? 'PC pronto para a SEXTA.' : 'Ainda existem bloqueios antes da instalação.'}  (${passed}/${required.length} essenciais)\n`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runDoctor();
  process.exitCode = result.ok ? 0 : 1;
}
