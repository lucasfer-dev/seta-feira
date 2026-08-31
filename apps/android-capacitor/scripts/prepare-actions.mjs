import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const androidRoot = path.join(appRoot, 'android', 'app', 'src', 'main');
const javaTarget = path.join(androidRoot, 'java', 'com', 'sexta', 'assistant');
const nativeJava = path.join(appRoot, 'native', 'java');

if (!fs.existsSync(javaTarget)) throw new Error('Projeto Android preparado não encontrado. Rode prepare-android primeiro.');

for (const name of ['AndroidActionExecutor.java', 'AndroidCommandLoop.java', 'SextaAccessibilityService.java']) {
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
if (!service.includes('AndroidCommandLoop.stop();')) {
  service = service.replace(
    '    @Override public void onDestroy() {\n        stopEverything();',
    '    @Override public void onDestroy() {\n        AndroidCommandLoop.stop();\n        stopEverything();'
  );
}

// If the command is spoken together with the wake phrase, execute it locally and
// do not open Gemini Live. Example: "Sexta-feira, abre o WhatsApp".
if (!service.includes('boolean localHandled = AndroidCommandLoop.executeText(this, pendingWakeCommand);')) {
  service = service.replace(
    '        pendingWakeCommand = tailAfterWake(heard);\n        stopWakeListening();',
    `        pendingWakeCommand = tailAfterWake(heard);
        if (!pendingWakeCommand.isEmpty()) {
            boolean localHandled = AndroidCommandLoop.executeText(this, pendingWakeCommand);
            if (localHandled) {
                String executedCommand = pendingWakeCommand;
                pendingWakeCommand = "";
                stopWakeListening();
                updateNotification("Comando executado • " + executedCommand);
                io.execute(() -> {
                    try { Thread.sleep(650); } catch (InterruptedException ignored) {}
                    if (!webConversationActive && !nativeConversationActive) startWakeListening();
                });
                return;
            }
        }
        stopWakeListening();`
  );
}

// If the user says the action after the wake beep, Gemini Live may already be
// connected. Intercept the input transcription before model audio is handled.
if (!service.includes('finishNativeAfterLocalAction(localCommand);')) {
  service = service.replace(
`            if (inTrans != null) {
                inputTranscript = mergeTranscript(inputTranscript, inTrans.optString("text", ""));
                if (isVoiceOffCommand(inputTranscript)) {`,
`            if (inTrans != null) {
                inputTranscript = mergeTranscript(inputTranscript, inTrans.optString("text", ""));
                if (!inputTranscript.isEmpty() && AndroidCommandLoop.executeText(this, inputTranscript)) {
                    String localCommand = inputTranscript;
                    persistTurn(localCommand, "Ação executada no Android.");
                    finishNativeAfterLocalAction(localCommand);
                    return;
                }
                if (isVoiceOffCommand(inputTranscript)) {`
  );

  service = service.replace(
    '    private synchronized void finishNativeConversation(boolean byVoice) {',
`    private synchronized void finishNativeAfterLocalAction(String command) {
        nativeConversationActive = false;
        stopLiveAudio();
        if (liveSocket != null) {
            try { liveSocket.close(1000, "local android action"); } catch (Exception ignored) {}
            liveSocket = null;
        }
        inputTranscript = "";
        outputTranscript = "";
        pendingWakeCommand = "";
        updateNotification("Comando executado • aguardando “Sexta-feira”");
        if (!webConversationActive) io.execute(() -> {
            try { Thread.sleep(500); } catch (InterruptedException ignored) {}
            startWakeListening();
        });
    }

    private synchronized void finishNativeConversation(boolean byVoice) {`
  );
}

fs.writeFileSync(servicePath, service);

const manifestPath = path.join(androidRoot, 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('SEXTA_APP_VISIBILITY_QUERIES')) {
  const queries = `
    <!-- SEXTA_APP_VISIBILITY_QUERIES -->
    <queries>
        <intent>
            <action android:name="android.intent.action.MAIN" />
            <category android:name="android.intent.category.LAUNCHER" />
        </intent>
        <package android:name="com.whatsapp" />
        <package android:name="com.whatsapp.w4b" />
        <package android:name="com.spotify.music" />
        <package android:name="com.google.android.youtube" />
        <package android:name="com.android.chrome" />
        <package android:name="com.google.android.gm" />
        <package android:name="com.google.android.apps.maps" />
        <package android:name="com.instagram.android" />
        <package android:name="org.telegram.messenger" />
        <package android:name="com.discord" />
        <package android:name="com.zhiliaoapp.musically" />
    </queries>`;
  manifest = manifest.replace(/(<application\b)/, `${queries}\n\n    $1`);
}

if (!manifest.includes('android:name=".SextaAccessibilityService"')) {
  manifest = manifest.replace('</application>', `
        <service
            android:name=".SextaAccessibilityService"
            android:label="Controle da SEXTA"
            android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.accessibilityservice.AccessibilityService" />
            </intent-filter>
            <meta-data
                android:name="android.accessibilityservice"
                android:resource="@xml/sexta_accessibility_service" />
        </service>
    </application>`);
}
fs.writeFileSync(manifestPath, manifest);

const xmlDir = path.join(androidRoot, 'res', 'xml');
fs.mkdirSync(xmlDir, { recursive: true });
fs.writeFileSync(path.join(xmlDir, 'sexta_accessibility_service.xml'), `<?xml version="1.0" encoding="utf-8"?>
<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/app_name"
    android:accessibilityEventTypes="typeWindowStateChanged"
    android:accessibilityFeedbackType="feedbackGeneric"
    android:notificationTimeout="100"
    android:canRetrieveWindowContent="false"
    android:canPerformGestures="false"
    android:settingsActivity="com.sexta.assistant.MainActivity" />\n`);

console.log('SEXTA Android Actions preparado: ações locais interceptadas antes do Gemini Live, visibilidade de apps e bridge de acessibilidade incluídas.');
