import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runDoctor } from './doctor.mjs';
import { probeWakeWord } from './wake-word.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_HOME = path.resolve(process.env.SEXTA_AGENT_HOME || path.join(ROOT, 'agent'));
const CONFIG_PATH = path.resolve(process.env.SEXTA_AGENT_CONFIG || path.join(AGENT_HOME, 'config.json'));
const ENV_PATH = path.resolve(process.env.SEXTA_ENV_PATH || path.join(ROOT, '.env.local'));
const rl = readline.createInterface({ input, output });

function ask(label, fallback = '') { return rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `).then(value => String(value || '').trim() || fallback); }
function where(name) { const result = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf8', windowsHide: true }); return result.status === 0 ? String(result.stdout || '').trim().split(/\r?\n/)[0] : ''; }
function firstExisting(candidates = []) { return candidates.filter(Boolean).find(candidate => fs.existsSync(candidate)) || ''; }
function yes(value) { return /^(?:s|sim|y|yes|1|true)$/i.test(String(value || '').trim()); }

function writeEnv(updates = {}) {
  fs.mkdirSync(path.dirname(ENV_PATH), { recursive: true });
  let text = ''; try { text = fs.readFileSync(ENV_PATH, 'utf8'); } catch {}
  const lines = text ? text.split(/\r?\n/) : []; const handled = new Set();
  const next = lines.map(line => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/i);
    if (!match || !(match[1] in updates)) return line;
    handled.add(match[1]); return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) if (!handled.has(key)) next.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, `${next.filter((line, index, arr) => line || index < arr.length - 1).join('\n').replace(/\n+$/, '')}\n`, 'utf8');
}
function browserPath() {
  return firstExisting([
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ]);
}

async function main() {
  console.log('\nSEXTA // FIRST CONTACT SETUP\n');
  if (process.platform !== 'win32') console.log('Aviso: o PC Agent completo foi desenhado para Windows.\n');
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });

  const baseUrl = await ask('SEXTA Cloud', 'https://seta-feira.vercel.app');
  const defaultId = `windows-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
  const deviceId = await ask('ID deste PC', defaultId);
  const deviceName = await ask('Nome que aparecerá na SEXTA', os.hostname());

  console.log('\nNa interface web: abra AGENTE → Parear PC e copie o código temporário.\n');
  const code = (await ask('Código de pairing')).toUpperCase();
  const pairResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/api/agent-pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, deviceId, deviceName }), signal: AbortSignal.timeout(10000)
  });
  const pair = await pairResponse.json().catch(() => ({}));
  if (!pairResponse.ok || !pair.token) throw new Error(pair.error || pair.message || `PAIRING_HTTP_${pairResponse.status}`);

  const projects = {};
  while (true) {
    const projectPath = await ask('Pasta de projeto permitida (Enter para terminar)');
    if (!projectPath) break;
    const resolved = path.resolve(projectPath.replace(/^"|"$/g, ''));
    if (!fs.existsSync(resolved)) { console.log('  Pasta não encontrada; tente de novo.'); continue; }
    const defaultName = path.basename(resolved).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    projects[await ask('Nome curto desse projeto', defaultName)] = resolved;
  }

  const codeCommand = where('code') || 'code'; const codexCommand = where('codex') || 'codex'; const browser = browserPath();
  const profileDir = path.join(os.homedir(), '.sexta-browser-profile');
  const wakeProbe = probeWakeWord();
  const wakeEnabled = wakeProbe.available && yes(await ask('Ativar wake word "Sexta" no Desktop', 's'));
  const config = {
    deviceName,
    apps: { vscode: { command: codeCommand, args: [] }, browser: browser ? { command: browser, args: [] } : { command: 'cmd', args: ['/c', 'start', '', 'https://www.google.com'] } },
    projects,
    codex: { command: codexCommand, timeoutMs: 900000 },
    browser: { command: browser, debugPort: 9223, profileDir },
    wakeWord: { enabled: wakeEnabled, phrases: ['sexta', 'sexta-feira'], engine: 'windows-system-speech' }
  };

  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  writeEnv({ SEXTA_BASE_URL: baseUrl.replace(/\/$/, ''), SEXTA_AGENT_TOKEN: pair.token, SEXTA_DEVICE_ID: deviceId });

  console.log(`\n✓ PC pareado como ${deviceName}`);
  console.log(`✓ config.json criado com ${Object.keys(projects).length} projeto(s)`);
  console.log('✓ token específico deste dispositivo salvo localmente');
  console.log(`${wakeEnabled ? '✓' : '△'} Wake word ${wakeEnabled ? 'habilitada' : 'desabilitada/opcional'}`);
  console.log('ℹ Segredos locais podem ser adicionados depois com: npm run sexta:vault -- set <alias>\n');
  await runDoctor({ print: true });
  console.log('Quando o Doctor estiver verde, rode: npm run agent:install\n');
}

try { await main(); }
catch (error) { console.error(`\nSetup interrompido: ${error?.message || error}\n`); process.exitCode = 1; }
finally { rl.close(); }
