import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const mainRoot = path.join(appRoot, 'android', 'app', 'src', 'main');
const javaTarget = path.join(mainRoot, 'java', 'com', 'sexta', 'assistant');
const nativeJava = path.join(appRoot, 'native', 'java');

if (!fs.existsSync(javaTarget)) throw new Error('Android preparado não encontrado. Rode prepare-actions antes.');

fs.copyFileSync(path.join(nativeJava, 'AndroidHandsExecutor.java'), path.join(javaTarget, 'AndroidHandsExecutor.java'));

const executorPath = path.join(javaTarget, 'AndroidActionExecutor.java');
let executor = fs.readFileSync(executorPath, 'utf8');

if (!executor.includes('.put("ui_snapshot")')) {
  executor = executor.replace(
    '.put("device_info");',
    `.put("device_info")
                .put("ui_snapshot")
                .put("ui_tap_text")
                .put("ui_scroll")
                .put("ui_back")
                .put("ui_home");`
  );
}

if (!executor.includes('case "ui_snapshot"')) {
  executor = executor.replace(
    '            case "device_info": return deviceInfo(context);',
    `            case "device_info": return deviceInfo(context);
            case "ui_snapshot":
            case "ui_tap_text":
            case "ui_scroll":
            case "ui_back":
            case "ui_home": return AndroidHandsExecutor.execute(action, payload);`
  );
}

fs.writeFileSync(executorPath, executor);

const accessibilityPath = path.join(mainRoot, 'res', 'xml', 'sexta_accessibility_service.xml');
if (!fs.existsSync(accessibilityPath)) throw new Error('Configuração de acessibilidade não encontrada.');
let accessibility = fs.readFileSync(accessibilityPath, 'utf8');
accessibility = accessibility
  .replace('android:accessibilityEventTypes="typeWindowStateChanged"', 'android:accessibilityEventTypes="typeWindowStateChanged|typeWindowContentChanged|typeViewScrolled"')
  .replace('android:canRetrieveWindowContent="false"', 'android:canRetrieveWindowContent="true"');
if (!accessibility.includes('android:accessibilityFlags=')) {
  accessibility = accessibility.replace(
    '    android:notificationTimeout="100"',
    '    android:notificationTimeout="100"\n    android:accessibilityFlags="flagReportViewIds|flagRetrieveInteractiveWindows"'
  );
}
fs.writeFileSync(accessibilityPath, accessibility);

console.log('SEXTA Hands v1 preparado: árvore de UI sob demanda + navegação segura, sem gestos/coords cegas.');
