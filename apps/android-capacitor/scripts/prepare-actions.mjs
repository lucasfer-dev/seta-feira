import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const androidRoot = path.join(appRoot, 'android', 'app', 'src', 'main');
const javaTarget = path.join(androidRoot, 'java', 'com', 'sexta', 'assistant');
const nativeJava = path.join(appRoot, 'native', 'java');

if (!fs.existsSync(javaTarget)) throw new Error('Projeto Android preparado não encontrado. Rode prepare-android primeiro.');

for (const name of ['AndroidActionExecutor.java', 'AndroidCommandLoop.java', 'CloudVoiceActionBridge.java', 'SextaAccessibilityService.java', 'SecureTokenStore.java']) {
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

// Capture the first utterance after the wake phrase locally. This guarantees
// that Android, Evolution API and Google Workspace actions are attempted before
// the request is ever sent to Gemini Live.
if (!service.includes('commandCaptureActive')) {
  service = service.replace(
    '    private volatile boolean wakeSeen = false;',
    `    private volatile boolean wakeSeen = false;
    private volatile boolean commandCaptureActive = false;
    private volatile boolean commandCapturePending = false;
    private volatile String commandCaptureText = "";
    private volatile long commandCaptureSession = 0L;`
  );
}

service = service.replace(
`    @Override public void onPartialResult(String hypothesis) {
        if (!wakeArmed) return;
        String text = jsonText(hypothesis);
        if (containsWake(text)) wakeSeen = true;
    }`,
`    @Override public void onPartialResult(String hypothesis) {
        String text = jsonText(hypothesis);
        if (commandCaptureActive) {
            if (!text.isEmpty()) commandCaptureText = text;
            return;
        }
        if (!wakeArmed) return;
        if (containsWake(text)) wakeSeen = true;
    }`
);

service = service.replace(
`    @Override public void onResult(String hypothesis) {
        if (!wakeArmed) return;
        String text = jsonText(hypothesis);
        if (wakeSeen || containsWake(text)) activateFromWake(text);
    }`,
`    @Override public void onResult(String hypothesis) {
        String text = jsonText(hypothesis);
        if (commandCaptureActive) {
            finishCommandCapture(text);
            return;
        }
        if (!wakeArmed) return;
        if (wakeSeen || containsWake(text)) activateFromWake(text);
    }`
);

service = service.replace(
`    @Override public void onFinalResult(String hypothesis) {
        if (!wakeArmed) return;
        String text = jsonText(hypothesis);
        if (wakeSeen || containsWake(text)) activateFromWake(text);
        else if (!webConversationActive && !nativeConversationActive) io.execute(() -> { try { Thread.sleep(120); } catch (InterruptedException ignored) {} startWakeListening(); });
    }`,
`    @Override public void onFinalResult(String hypothesis) {
        String text = jsonText(hypothesis);
        if (commandCaptureActive) {
            finishCommandCapture(text);
            return;
        }
        if (!wakeArmed) return;
        if (wakeSeen || containsWake(text)) activateFromWake(text);
        else if (!webConversationActive && !nativeConversationActive && !commandCapturePending) io.execute(() -> { try { Thread.sleep(120); } catch (InterruptedException ignored) {} startWakeListening(); });
    }`
);

service = service.replace(
`    @Override public void onError(Exception exception) {
        stopWakeListening();
        if (!webConversationActive && !nativeConversationActive) io.execute(() -> { try { Thread.sleep(700); } catch (InterruptedException ignored) {} startWakeListening(); });
    }`,
`    @Override public void onError(Exception exception) {
        if (commandCaptureActive) {
            finishCommandCapture(commandCaptureText);
            return;
        }
        stopWakeListening();
        if (!webConversationActive && !nativeConversationActive && !commandCapturePending) io.execute(() -> { try { Thread.sleep(700); } catch (InterruptedException ignored) {} startWakeListening(); });
    }`
);

service = service.replace(
`    @Override public void onTimeout() {
        stopWakeListening();
        if (!webConversationActive && !nativeConversationActive) startWakeListening();
    }`,
`    @Override public void onTimeout() {
        if (commandCaptureActive) {
            finishCommandCapture(commandCaptureText);
            return;
        }
        stopWakeListening();
        if (!webConversationActive && !nativeConversationActive && !commandCapturePending) startWakeListening();
    }`
);

service = service.replace(
`    private synchronized void activateFromWake(String heard) {
        if (nativeConversationActive) return;
        pendingWakeCommand = tailAfterWake(heard);
        stopWakeListening();
        nativeConversationActive = true;
        inputTranscript = "";
        outputTranscript = "";
        updateNotification("SEXTA ativa • conectando Gemini Live...");
        io.execute(this::connectNativeLive);
    }`,
`    private synchronized void activateFromWake(String heard) {
        if (nativeConversationActive || commandCaptureActive || commandCapturePending) return;
        pendingWakeCommand = tailAfterWake(heard);
        stopWakeListening();

        if (!pendingWakeCommand.isEmpty()) {
            routeCapturedCommand(pendingWakeCommand);
            return;
        }

        commandCapturePending = true;
        updateNotification("SEXTA ativa • preparando comando...");
        io.execute(() -> {
            try { Thread.sleep(260L); } catch (InterruptedException ignored) {}
            synchronized (SextaForegroundService.this) {
                commandCapturePending = false;
                if (!webConversationActive && !nativeConversationActive) startCommandCapture();
            }
        });
    }

    private synchronized void startCommandCapture() {
        if (wakeModel == null || commandCaptureActive || nativeConversationActive || webConversationActive) {
            if (!nativeConversationActive && !webConversationActive) startNativeConversationWithText("");
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            updateNotification("Abra a SEXTA e permita o microfone");
            scheduleWakeRestart(1200L);
            return;
        }
        try {
            Recognizer recognizer = new Recognizer(wakeModel, INPUT_RATE);
            wakeSpeech = new SpeechService(recognizer, INPUT_RATE);
            commandCaptureText = "";
            commandCaptureActive = true;
            wakeArmed = true;
            final long session = ++commandCaptureSession;
            wakeSpeech.startListening(this);
            updateNotification("SEXTA ativa • diga o comando...");
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 45);
            tone.startTone(ToneGenerator.TONE_PROP_ACK, 100);
            io.execute(() -> {
                try { Thread.sleep(160L); } catch (InterruptedException ignored) {}
                try { tone.release(); } catch (Exception ignored) {}
            });
            io.execute(() -> {
                try { Thread.sleep(4300L); } catch (InterruptedException ignored) {}
                synchronized (SextaForegroundService.this) {
                    if (commandCaptureActive && session == commandCaptureSession) finishCommandCapture(commandCaptureText);
                }
            });
        } catch (Exception error) {
            commandCaptureActive = false;
            updateNotification("Falha ao ouvir comando local");
            startNativeConversationWithText("");
        }
    }

    private synchronized void finishCommandCapture(String heard) {
        if (!commandCaptureActive) return;
        commandCaptureActive = false;
        commandCaptureSession++;
        String captured = String.valueOf(heard == null ? "" : heard).trim();
        if (captured.isEmpty()) captured = commandCaptureText == null ? "" : commandCaptureText.trim();
        commandCaptureText = "";
        stopWakeListening();
        if (captured.isEmpty()) {
            startNativeConversationWithText("");
            return;
        }
        routeCapturedCommand(captured);
    }

    private void routeCapturedCommand(String captured) {
        final String command = String.valueOf(captured == null ? "" : captured).trim();
        if (command.isEmpty()) {
            startNativeConversationWithText("");
            return;
        }

        JSONObject localStatus = AndroidCommandLoop.executeTextResult(this, command);
        if (localStatus.optBoolean("handled", false)) {
            completeRoutedAction(command, "android", localStatus);
            return;
        }

        updateNotification("SEXTA ativa • verificando integrações...");
        io.execute(() -> {
            JSONObject cloudStatus = CloudVoiceActionBridge.execute(SextaForegroundService.this, command);
            synchronized (SextaForegroundService.this) {
                if (cloudStatus.optBoolean("handled", false)) {
                    completeRoutedAction(command, cloudStatus.optString("provider", "cloud"), cloudStatus);
                } else {
                    startNativeConversationWithText(command);
                }
            }
        });
    }

    private synchronized void completeRoutedAction(String command, String provider, JSONObject status) {
        boolean ok = status.optBoolean("ok", false);
        String reply = status.optString("reply", status.optString("message", ok ? "Ação executada." : "Não consegui executar a ação."));
        if (reply.length() > 180) reply = reply.substring(0, 180);
        updateNotification((ok ? "✓ " : "⚠ ") + reply);
        if ("android".equals(provider)) persistTurn(command, ok ? "Ação executada no Android." : "Falha Android: " + reply);
        scheduleWakeRestart(ok ? 900L : 2600L);
    }

    private void scheduleWakeRestart(long delayMs) {
        io.execute(() -> {
            try { Thread.sleep(delayMs); } catch (InterruptedException ignored) {}
            if (!webConversationActive && !nativeConversationActive && !commandCaptureActive && !commandCapturePending) startWakeListening();
        });
    }

    private synchronized void startNativeConversationWithText(String text) {
        pendingWakeCommand = String.valueOf(text == null ? "" : text).trim();
        nativeConversationActive = true;
        inputTranscript = "";
        outputTranscript = "";
        updateNotification("SEXTA ativa • conectando Gemini Live...");
        io.execute(this::connectNativeLive);
    }`
);

// Keep transcription explicit on the Android setup; the ephemeral token also
// locks these fields server-side.
if (!service.includes('.put("inputAudioTranscription", new JSONObject())')) {
  service = service.replace(
`                                .put("model", "models/" + liveModel)
                                .put("generationConfig", new JSONObject().put("responseModalities", new JSONArray().put("AUDIO"))));`,
`                                .put("model", "models/" + liveModel)
                                .put("generationConfig", new JSONObject().put("responseModalities", new JSONArray().put("AUDIO")))
                                .put("inputAudioTranscription", new JSONObject())
                                .put("outputAudioTranscription", new JSONObject()));`
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

console.log('SEXTA Android Actions preparado: Android -> Evolution/Google -> Gemini, nesta ordem.');
