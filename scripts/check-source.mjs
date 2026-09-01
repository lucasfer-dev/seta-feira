import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['.git', 'node_modules', 'android', 'dist', 'coverage']);
const extensions = new Set(['.js', '.mjs', '.cjs']);

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(target));
    else if (extensions.has(path.extname(entry.name))) files.push(target);
  }
  return files;
}

function check(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Sintaxe inválida: ${path.relative(root, file)}`)));
  });
}

const files = await collect(root);
for (const file of files) await check(file);
console.log(`Sintaxe validada em ${files.length} arquivos JavaScript.`);
