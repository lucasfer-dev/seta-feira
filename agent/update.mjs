import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDoctor } from './doctor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} falhou`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || 'comando falhou').trim());
  return String(result.stdout || '').trim();
}

console.log('\nSEXTA // UPDATE\n');
try {
  const dirty = capture('git', ['status', '--porcelain']);
  if (dirty) throw new Error('Há alterações locais no repositório. Faça commit/stash antes de atualizar para evitar perda de arquivos.');
  run('git', ['fetch', 'origin', 'main']);
  run('git', ['pull', '--ff-only', 'origin', 'main']);
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install']);
  const result = await runDoctor({ print: true });
  if (!result.ok) throw new Error('Atualização aplicada, mas o Doctor encontrou bloqueios.');
  console.log('Atualização concluída. Reinicie o agente com o Agendador de Tarefas ou npm run agent:start.\n');
} catch (error) {
  console.error(`Atualização interrompida: ${error?.message || error}\n`);
  process.exitCode = 1;
}
