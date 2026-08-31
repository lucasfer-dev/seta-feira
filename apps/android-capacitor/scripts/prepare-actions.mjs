import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const javaTarget = path.join(appRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'sexta', 'assistant');
const nativeJava = path.join(appRoot, 'native', 'java');

if (!fs.existsSync(javaTarget)) throw new Error('Projeto Android preparado não encontrado. Rode prepare-android primeiro.');

for (const name of ['AndroidActionExecutor.java', 'AndroidCommandLoop.java']) {
  fs.copyFileSync(path.join(nativeJava, name), path.join(javaTarget, name));
}

const servicePath = path.join(javaTarget, 'SextaForegroundService.java');
let service = fs.readFileSync(servicePath, 'utf8');
if (!service.includes('AndroidCommandLoop.start(this);')) {
  service = service.replace(
    '        super.onCreate();\n        createNotificationChannel();',
    '        super.onCreate();\n        AndroidCommandLoop.start(this);\n        createNotificationChannel();'
  );
}
fs.writeFileSync(servicePath, service);

console.log('SEXTA Android Actions preparado: command loop + executor nativo incluídos no APK.');
