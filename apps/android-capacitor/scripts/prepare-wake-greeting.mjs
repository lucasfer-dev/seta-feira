import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const mainRoot = path.join(appRoot, 'android', 'app', 'src', 'main');
const javaRoot = path.join(mainRoot, 'java', 'com', 'sexta', 'assistant');
const nativeJava = path.join(appRoot, 'native', 'java');
const servicePath = path.join(javaRoot, 'SextaForegroundService.java');
const mainActivityPath = path.join(javaRoot, 'MainActivity.java');

if (!fs.existsSync(servicePath) || !fs.existsSync(mainActivityPath)) {
  throw new Error('Projeto Android preparado não encontrado para wake gate/greeting.');
}

fs.copyFileSync(path.join(nativeJava, 'StartupGreeting.java'), path.join(javaRoot, 'StartupGreeting.java'));

let activity = fs.readFileSync(mainActivityPath, 'utf8');
if (!activity.includes('StartupGreeting.onAppOpened(this);')) {
  activity = activity.replace(
    '\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {',
    `\n    @Override\n    protected void onStart() {\n        super.onStart();\n        StartupGreeting.onAppOpened(this);\n    }\n\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {`
  );
}
if (!activity.includes('StartupGreeting.shutdown();')) {
  activity = activity.replace(
    '\n}\n',
    `\n    @Override\n    protected void onDestroy() {\n        StartupGreeting.shutdown();\n        super.onDestroy();\n    }\n}\n`
  );
}
fs.writeFileSync(mainActivityPath, activity);

let service = fs.readFileSync(servicePath, 'utf8');

// Wake-gated turn mode: once SEXTA starts speaking, ambient sound must not be
// forwarded to Gemini Live. This prevents television/conversation/echo from
// interrupting the answer. The next request starts only after a new wake word.
if (!service.includes('SEXTA_WAKE_GATED_INPUT')) {
  service = service.replace(
    '                if (read <= 0 || !liveReady.get() || liveSocket == null) continue;\n                trackDuplexActivity(buffer, read);',
    `                if (read <= 0 || !liveReady.get() || liveSocket == null) continue;\n                // SEXTA_WAKE_GATED_INPUT: while the assistant is speaking, discard mic frames.\n                // The user starts another turn by saying the wake phrase after this response.\n                if (assistantSpeaking.get()) continue;\n                trackDuplexActivity(buffer, read);`
  );
}

// One wake phrase = one conversational turn. Close Live after the audio tail has
// had time to drain, then return to the local Vosk wake listener.
if (!service.includes('SEXTA_WAKE_GATED_TURN_COMPLETE')) {
  service = service.replace(
    '                persistTurn(user, assistant);\n                updateNotification("SEXTA ativa • ouvindo...");',
    `                persistTurn(user, assistant);\n                updateNotification("Resposta concluída • aguardando “Sexta-feira”...");\n                // SEXTA_WAKE_GATED_TURN_COMPLETE\n                io.schedule(() -> finishNativeConversation(false), 420L, TimeUnit.MILLISECONDS);`
  );
}

service = service.replace(
  'A conversa é contínua.\\n\\n',
  'Cada ativação por “Sexta-feira” corresponde a um turno. Responda apenas ao pedido ativado e não trate fala ambiente como nova solicitação.\\n\\n'
);

fs.writeFileSync(servicePath, service);

console.log('SEXTA Android wake-gated preparado: 1 wake = 1 turno, áudio ambiente não interrompe a fala + saudação nativa.');
