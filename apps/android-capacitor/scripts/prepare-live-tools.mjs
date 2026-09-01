import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const javaTarget = path.join(appRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'sexta', 'assistant');
const source = path.join(appRoot, 'native', 'java', 'LiveToolBridgePlugin.java');
const target = path.join(javaTarget, 'LiveToolBridgePlugin.java');

if (!fs.existsSync(javaTarget)) throw new Error('Projeto Android preparado não encontrado. Rode android:prepare após cap sync.');
fs.copyFileSync(source, target);
console.log('SEXTA Live Tool Bridge preparado.');
