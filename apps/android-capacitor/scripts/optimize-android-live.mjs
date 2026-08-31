import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const servicePath = path.join(appRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'sexta', 'assistant', 'SextaForegroundService.java');

if (!fs.existsSync(servicePath)) throw new Error('SextaForegroundService.java não encontrado. Rode android:prepare na ordem padrão.');
let service = fs.readFileSync(servicePath, 'utf8');

// Cache do contexto: a ativação por wake word não deve esperar /api/sync.
if (!service.includes('CONTEXT_CACHE_TTL_MS')) {
  service = service.replace(
    '    private static final int OUTPUT_RATE = 24000;',
    `    private static final int OUTPUT_RATE = 24000;\n    private static final long CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000L;\n    private volatile String cachedSystemInstruction = "";\n    private volatile long cachedSystemInstructionAt = 0L;\n    private final AtomicBoolean contextRefreshRunning = new AtomicBoolean(false);`
  );
}

service = service.replace(
  '        if (!webConversationActive && !nativeConversationActive) initWakeModel();',
  '        if (!webConversationActive && !nativeConversationActive) initWakeModel();\n        refreshSystemInstructionAsync(false);'
);

const oldBuild = `    private String buildSystemInstruction() {\n        StringBuilder instruction = new StringBuilder();`;
const newBuild = `    private String baseSystemInstruction() {\n        return "Você é SEXTA-feira, uma assistente pessoal de voz em um celular Android. Fale sempre em português brasileiro natural, curta por padrão e mantenha uma única identidade vocal feminina. "\n                + "A conversa é contínua. Não afirme que executou ações externas sem confirmação real. Se o usuário pedir para desligar ou sair do modo de voz, responda o mínimo possível porque o aplicativo encerrará localmente.\\n\\n";\n    }\n\n    private String buildSystemInstruction() {\n        String cached = cachedSystemInstruction;\n        if (cached != null && !cached.isEmpty()) {\n            if (System.currentTimeMillis() - cachedSystemInstructionAt > CONTEXT_CACHE_TTL_MS) refreshSystemInstructionAsync(false);\n            return cached;\n        }\n        refreshSystemInstructionAsync(false);\n        return baseSystemInstruction();\n    }\n\n    private String fetchSystemInstruction() {\n        StringBuilder instruction = new StringBuilder();`;
if (service.includes(oldBuild)) service = service.replace(oldBuild, newBuild);

service = service.replace(
  '        instruction.append("Você é SEXTA-feira, uma assistente pessoal de voz em um celular Android. Fale sempre em português brasileiro natural, curta por padrão e mantenha uma única identidade vocal feminina. ");\n        instruction.append("A conversa é contínua. Não afirme que executou ações externas sem confirmação real. Se o usuário pedir para desligar ou sair do modo de voz, responda o mínimo possível porque o aplicativo encerrará localmente.\\n\\n");',
  '        instruction.append(baseSystemInstruction());'
);

const buildEnd = `        } catch (Exception ignored) {}\n        return instruction.toString();\n    }\n\n    private void connectNativeLive()`;
const buildEndReplacement = `        } catch (Exception ignored) {}\n        return instruction.toString();\n    }\n\n    private void refreshSystemInstructionAsync(boolean force) {\n        if (!force && cachedSystemInstruction != null && !cachedSystemInstruction.isEmpty()\n                && System.currentTimeMillis() - cachedSystemInstructionAt < CONTEXT_CACHE_TTL_MS) return;\n        if (!contextRefreshRunning.compareAndSet(false, true)) return;\n        io.execute(() -> {\n            try {\n                String fresh = fetchSystemInstruction();\n                if (fresh != null && !fresh.isEmpty()) {\n                    cachedSystemInstruction = fresh;\n                    cachedSystemInstructionAt = System.currentTimeMillis();\n                }\n            } finally {\n                contextRefreshRunning.set(false);\n            }\n        });\n    }\n\n    private void connectNativeLive()`;
if (service.includes(buildEnd)) service = service.replace(buildEnd, buildEndReplacement);

// 40 ms de PCM a 16 kHz/16-bit mono em vez de ~100 ms. Menos atraso de entrada.
service = service.replace('            byte[] buffer = new byte[3200];', '            byte[] buffer = new byte[1280];');

// Segunda rodada: reduz a pausa entre a wake word e a captura do comando.
service = service.replace('            try { Thread.sleep(260L); } catch (InterruptedException ignored) {}', '            try { Thread.sleep(80L); } catch (InterruptedException ignored) {}');

// Evita ficar mais de 4 s esperando o comando local antes do fallback.
service = service.replace('                try { Thread.sleep(4300L); } catch (InterruptedException ignored) {}', '                try { Thread.sleep(2500L); } catch (InterruptedException ignored) {}');

// Atualiza o contexto depois de cada turno sem bloquear a conversa atual.
service = service.replace(
  '                try (Response ignored = http.newCall(req).execute()) {}',
  '                try (Response ignored = http.newCall(req).execute()) {}\n                refreshSystemInstructionAsync(true);'
);

fs.writeFileSync(servicePath, service);
console.log('SEXTA Android Live otimizado: contexto em cache + refresh assíncrono + PCM 40 ms + wake 80 ms + captura local 2,5 s.');
