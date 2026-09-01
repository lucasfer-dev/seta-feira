package com.sexta.assistant;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.MediaRecorder;
import android.media.ToneGenerator;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.NoiseSuppressor;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;
import org.vosk.android.RecognitionListener;
import org.vosk.android.SpeechService;
import org.vosk.android.StorageService;

import java.io.IOException;
import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

public class SextaForegroundService extends Service implements RecognitionListener {
    public static final String ACTION_START = "com.sexta.assistant.action.START";
    public static final String ACTION_STOP = "com.sexta.assistant.action.STOP";
    public static final String ACTION_CONVERSATION_STATE = "com.sexta.assistant.CONVERSATION_STATE";
    public static final String EXTRA_ACTIVE = "active";

    private static final int NOTIFICATION_ID = 2606;
    private static final String CHANNEL_ID = "sexta_background_assistant";
    private static final String BASE_URL = "https://seta-feira.vercel.app";
    private static final String WS_BASE = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
    private static final int INPUT_RATE = 16000;
    private static final int OUTPUT_RATE = 24000;

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build();

    private Model wakeModel;
    private SpeechService wakeSpeech;
    private volatile boolean wakeLoading = false;
    private volatile boolean webConversationActive = false;
    private volatile boolean nativeConversationActive = false;
    private volatile boolean wakeArmed = false;
    private volatile boolean wakeSeen = false;

    private WebSocket liveSocket;
    private final AtomicBoolean liveReady = new AtomicBoolean(false);
    private final AtomicBoolean audioRunning = new AtomicBoolean(false);
    private final AtomicBoolean assistantSpeaking = new AtomicBoolean(false);
    private AudioRecord audioRecord;
    private AudioTrack audioTrack;
    private AcousticEchoCanceler echoCanceler;
    private NoiseSuppressor noiseSuppressor;
    private Thread captureThread;
    private final Set<String> canceledToolIds = ConcurrentHashMap.newKeySet();
    private String inputTranscript = "";
    private String outputTranscript = "";
    private String pendingWakeCommand = "";
    private PowerManager.WakeLock wakeLock;

    private final BroadcastReceiver conversationReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!ACTION_CONVERSATION_STATE.equals(intent.getAction())) return;
            webConversationActive = intent.getBooleanExtra(EXTRA_ACTIVE, false);
            if (webConversationActive) {
                stopWakeListening();
            } else if (!nativeConversationActive) {
                startWakeListening();
            }
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        registerReceiver(conversationReceiver, new IntentFilter(ACTION_CONVERSATION_STATE), Context.RECEIVER_NOT_EXPORTED);
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SEXTA:BackgroundAssistant");
        wakeLock.setReferenceCounted(false);
        LibVosk.setLogLevel(LogLevel.WARNINGS);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;
        if (ACTION_STOP.equals(action)) {
            stopEverything();
            stopSelf();
            return START_NOT_STICKY;
        }

        startAsForeground("Aguardando “Sexta-feira”");
        getSharedPreferences("sexta_native", MODE_PRIVATE).edit().putBoolean("background_active", true).apply();
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            updateNotification("Abra a SEXTA e permita o microfone");
            return START_STICKY;
        }
        if (!webConversationActive && !nativeConversationActive) initWakeModel();
        return START_STICKY;
    }

    private void startAsForeground(String text) {
        Notification notification = buildNotification(text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "SEXTA em segundo plano", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Mantém a palavra de ativação local e a conversa de voz da SEXTA disponíveis.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPending = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, SextaForegroundService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 2, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("SEXTA")
                .setContentText(text)
                .setContentIntent(openPending)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .addAction(android.R.drawable.ic_media_pause, "Parar", stopPending)
                .build();
    }

    private void updateNotification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private synchronized void initWakeModel() {
        if (wakeModel != null) { startWakeListening(); return; }
        if (wakeLoading) return;
        wakeLoading = true;
        updateNotification("Preparando wake word local...");
        StorageService.unpack(this, "model-pt", "model-pt-runtime", model -> {
            wakeLoading = false;
            wakeModel = model;
            startWakeListening();
        }, error -> {
            wakeLoading = false;
            updateNotification("Wake word local indisponível");
        });
    }

    private synchronized void startWakeListening() {
        if (wakeModel == null || wakeSpeech != null || webConversationActive || nativeConversationActive) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        try {
            Recognizer recognizer = new Recognizer(wakeModel, INPUT_RATE);
            wakeSpeech = new SpeechService(recognizer, INPUT_RATE);
            wakeSeen = false;
            wakeArmed = true;
            wakeSpeech.startListening(this);
            updateNotification("Aguardando “Sexta-feira”");
        } catch (IOException error) {
            updateNotification("Não consegui abrir o microfone local");
        }
    }

    private synchronized void stopWakeListening() {
        wakeArmed = false;
        if (wakeSpeech != null) {
            try { wakeSpeech.stop(); } catch (Exception ignored) {}
            try { wakeSpeech.shutdown(); } catch (Exception ignored) {}
            wakeSpeech = null;
        }
    }

    private String jsonText(String hypothesis) {
        try {
            JSONObject obj = new JSONObject(hypothesis == null ? "{}" : hypothesis);
            String partial = obj.optString("partial", "").trim();
            String text = obj.optString("text", "").trim();
            return !text.isEmpty() ? text : partial;
        } catch (Exception ignored) { return ""; }
    }

    private String normalize(String text) {
        String v = Normalizer.normalize(text == null ? "" : text, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9 ]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return v;
    }

    private boolean containsWake(String text) {
        String v = normalize(text);
        return v.contains("sexta feira") || v.equals("sexta") || v.startsWith("sexta ");
    }

    private String tailAfterWake(String text) {
        String v = normalize(text);
        int pos = v.indexOf("sexta feira");
        if (pos >= 0) return v.substring(pos + "sexta feira".length()).trim();
        if (v.startsWith("sexta")) return v.substring("sexta".length()).trim();
        return "";
    }

    @Override public void onPartialResult(String hypothesis) {
        if (!wakeArmed) return;
        String text = jsonText(hypothesis);
        if (containsWake(text)) wakeSeen = true;
    }

    @Override public void onResult(String hypothesis) {
        if (!wakeArmed) return;
        String text = jsonText(hypothesis);
        if (wakeSeen || containsWake(text)) activateFromWake(text);
    }

    @Override public void onFinalResult(String hypothesis) {
        if (!wakeArmed) return;
        String text = jsonText(hypothesis);
        if (wakeSeen || containsWake(text)) activateFromWake(text);
        else if (!webConversationActive && !nativeConversationActive) io.execute(() -> { try { Thread.sleep(120); } catch (InterruptedException ignored) {} startWakeListening(); });
    }

    @Override public void onError(Exception exception) {
        stopWakeListening();
        if (!webConversationActive && !nativeConversationActive) io.execute(() -> { try { Thread.sleep(700); } catch (InterruptedException ignored) {} startWakeListening(); });
    }

    @Override public void onTimeout() {
        stopWakeListening();
        if (!webConversationActive && !nativeConversationActive) startWakeListening();
    }

    private synchronized void activateFromWake(String heard) {
        if (nativeConversationActive) return;
        pendingWakeCommand = tailAfterWake(heard);
        stopWakeListening();
        nativeConversationActive = true;
        inputTranscript = "";
        outputTranscript = "";
        updateNotification("SEXTA ativa • conectando Gemini Live...");
        io.execute(this::connectNativeLive);
    }

    private String ownerToken() {
        return SecureTokenStore.getOwnerToken(this);
    }
    private String conversationId() {
        return getSharedPreferences("sexta_native", MODE_PRIVATE).getString("conversation_id", "main");
    }
    private String deviceId() {
        return getSharedPreferences("sexta_native", MODE_PRIVATE).getString("device_id", "android-native");
    }

    private Request.Builder authorized(String url) {
        Request.Builder builder = new Request.Builder().url(url).header("Content-Type", "application/json");
        String token = ownerToken();
        if (!token.isEmpty()) builder.header("Authorization", "Bearer " + token);
        return builder;
    }

    private String buildSystemInstruction() {
        StringBuilder instruction = new StringBuilder();
        instruction.append("Você é SEXTA-feira, uma assistente pessoal de voz em um celular Android. Fale sempre em português brasileiro natural, curta por padrão e mantenha uma única identidade vocal feminina. ");
        instruction.append("A conversa é contínua. Não afirme que executou ações externas sem confirmação real. Se o usuário pedir para desligar ou sair do modo de voz, responda o mínimo possível porque o aplicativo encerrará localmente.\n\n");
        String token = ownerToken();
        if (token.isEmpty()) return instruction.toString();
        try {
            Request req = authorized(BASE_URL + "/api/sync?conversationId=" + java.net.URLEncoder.encode(conversationId(), "UTF-8")).get().build();
            try (Response res = http.newCall(req).execute()) {
                if (!res.isSuccessful() || res.body() == null) return instruction.toString();
                JSONObject data = new JSONObject(res.body().string());
                JSONArray memories = data.optJSONArray("memories");
                if (memories != null && memories.length() > 0) {
                    instruction.append("Memórias relevantes:\n");
                    for (int i = 0; i < Math.min(10, memories.length()); i++) instruction.append("- ").append(memories.optJSONObject(i).optString("content", "")).append("\n");
                }
                JSONArray messages = data.optJSONArray("messages");
                if (messages != null && messages.length() > 0) {
                    instruction.append("\nContexto recente:\n");
                    for (int i = Math.max(0, messages.length() - 6); i < messages.length(); i++) {
                        JSONObject m = messages.optJSONObject(i);
                        instruction.append("assistant".equals(m.optString("role")) ? "SEXTA: " : "USUÁRIO: ").append(m.optString("content", "")).append("\n");
                    }
                }
            }
        } catch (Exception ignored) {}
        return instruction.toString();
    }

    private void connectNativeLive() {
        String token = ownerToken();
        if (token.isEmpty()) {
            nativeConversationActive = false;
            updateNotification("Abra o app e faça login para usar o Live");
            startWakeListening();
            return;
        }
        try {
            JSONObject body = new JSONObject().put("systemInstruction", buildSystemInstruction());
            Request req = authorized(BASE_URL + "/api/live-token")
                    .post(RequestBody.create(body.toString(), MediaType.parse("application/json; charset=utf-8"))).build();
            String ephemeral;
            String model;
            try (Response res = http.newCall(req).execute()) {
                if (!res.isSuccessful() || res.body() == null) throw new IOException("live-token " + res.code());
                JSONObject data = new JSONObject(res.body().string());
                ephemeral = data.optString("token", "");
                model = data.optString("model", "gemini-3.1-flash-live-preview");
            }
            if (ephemeral.isEmpty()) throw new IOException("token Live vazio");
            final String liveModel = model;
            Request wsRequest = new Request.Builder().url(WS_BASE + "?access_token=" + java.net.URLEncoder.encode(ephemeral, "UTF-8")).build();
            liveSocket = http.newWebSocket(wsRequest, new WebSocketListener() {
                @Override public void onOpen(WebSocket webSocket, Response response) {
                    try {
                        JSONObject setup = new JSONObject().put("setup", new JSONObject()
                                .put("model", "models/" + liveModel)
                                .put("generationConfig", new JSONObject().put("responseModalities", new JSONArray().put("AUDIO"))));
                        webSocket.send(setup.toString());
                    } catch (Exception error) { finishNativeConversation(false); }
                }

                @Override public void onMessage(WebSocket webSocket, String text) { handleLiveMessage(text); }

                @Override public void onFailure(WebSocket webSocket, Throwable t, @Nullable Response response) {
                    finishNativeConversation(false);
                }

                @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                    if (nativeConversationActive) finishNativeConversation(false);
                }
            });
        } catch (Exception error) {
            finishNativeConversation(false);
        }
    }

    private synchronized void handleLiveMessage(String raw) {
        try {
            JSONObject message = new JSONObject(raw);
            if (message.has("setupComplete")) {
                liveReady.set(true);
                updateNotification("SEXTA ativa • ouvindo...");
                startLiveAudio();
                ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_MUSIC, 35);
                tone.startTone(ToneGenerator.TONE_PROP_ACK, 90);
                io.execute(() -> { try { Thread.sleep(150); } catch (InterruptedException ignored) {} tone.release(); });
                if (!pendingWakeCommand.isEmpty() && liveSocket != null) {
                    JSONObject client = new JSONObject().put("clientContent", new JSONObject()
                            .put("turns", new JSONArray().put(new JSONObject().put("role", "user").put("parts", new JSONArray().put(new JSONObject().put("text", pendingWakeCommand)))))
                            .put("turnComplete", true));
                    liveSocket.send(client.toString());
                    inputTranscript = pendingWakeCommand;
                    pendingWakeCommand = "";
                }
                return;
            }

            JSONObject cancellation = message.optJSONObject("toolCallCancellation");
            if (cancellation != null) {
                JSONArray ids = cancellation.optJSONArray("ids");
                if (ids != null) for (int i = 0; i < ids.length(); i++) {
                    String id = ids.optString(i, "");
                    if (!id.isEmpty()) canceledToolIds.add(id);
                }
            }

            JSONObject toolCall = message.optJSONObject("toolCall");
            if (toolCall != null) {
                handleNativeToolCall(toolCall);
                return;
            }

            JSONObject content = message.optJSONObject("serverContent");
            if (content == null) return;
            JSONObject inTrans = content.optJSONObject("inputTranscription");
            if (inTrans != null) {
                inputTranscript = mergeTranscript(inputTranscript, inTrans.optString("text", ""));
                if (isVoiceOffCommand(inputTranscript)) {
                    persistTurn(inputTranscript, outputTranscript);
                    finishNativeConversation(true);
                    return;
                }
            }
            JSONObject outTrans = content.optJSONObject("outputTranscription");
            if (outTrans != null) outputTranscript = mergeTranscript(outputTranscript, outTrans.optString("text", ""));

            if (content.optBoolean("interrupted", false)) {
                assistantSpeaking.set(false);
                if (audioTrack != null) { try { audioTrack.pause(); audioTrack.flush(); audioTrack.play(); } catch (Exception ignored) {} }
            }

            JSONObject modelTurn = content.optJSONObject("modelTurn");
            JSONArray parts = modelTurn != null ? modelTurn.optJSONArray("parts") : null;
            if (parts != null) {
                for (int i = 0; i < parts.length(); i++) {
                    JSONObject inline = parts.optJSONObject(i).optJSONObject("inlineData");
                    if (inline == null) continue;
                    String data = inline.optString("data", "");
                    if (!data.isEmpty()) playPcm(Base64.decode(data, Base64.DEFAULT));
                }
            }
            if (content.optBoolean("turnComplete", false)) {
                assistantSpeaking.set(false);
                String user = inputTranscript;
                String assistant = outputTranscript;
                inputTranscript = "";
                outputTranscript = "";
                persistTurn(user, assistant);
                updateNotification("SEXTA ativa • ouvindo...");
            }
        } catch (Exception ignored) {}
    }

    private void handleNativeToolCall(JSONObject toolCall) {
        JSONArray calls = toolCall.optJSONArray("functionCalls");
        if (calls == null) return;
        for (int i = 0; i < calls.length(); i++) {
            JSONObject call = calls.optJSONObject(i);
            if (call == null) continue;
            final String id = call.optString("id", "");
            final String name = call.optString("name", "");
            final JSONObject args = call.optJSONObject("args") == null ? new JSONObject() : call.optJSONObject("args");
            if (name.isEmpty()) continue;
            io.execute(() -> {
                if (!id.isEmpty() && canceledToolIds.contains(id)) return;
                JSONObject result = executeNativeTool(name, args);
                if (!id.isEmpty() && canceledToolIds.contains(id)) {
                    canceledToolIds.remove(id);
                    return;
                }
                sendNativeToolResponse(id, name, result);
                if (!id.isEmpty()) canceledToolIds.remove(id);
            });
        }
    }

    private JSONObject executeNativeTool(String name, JSONObject args) {
        try {
            JSONObject requestBody = new JSONObject()
                    .put("name", name)
                    .put("args", args == null ? new JSONObject() : args)
                    .put("deviceId", deviceId())
                    .put("preferLocalAndroid", name.startsWith("android_"))
                    .put("origin", "android");
            Request request = authorized(BASE_URL + "/api/tool-execute")
                    .post(RequestBody.create(requestBody.toString(), MediaType.parse("application/json; charset=utf-8")))
                    .build();
            try (Response response = http.newCall(request).execute()) {
                if (response.body() == null) return new JSONObject().put("ok", false).put("handled", true).put("state", "failed").put("error", "EMPTY_TOOL_RESPONSE");
                JSONObject result = new JSONObject(response.body().string());
                if (!response.isSuccessful()) return new JSONObject().put("ok", false).put("handled", true).put("state", "failed").put("error", result.optString("message", "TOOL_HTTP_" + response.code()));

                JSONObject clientAction = result.optJSONObject("clientAction");
                if (clientAction != null && !clientAction.optString("action", "").isEmpty()) {
                    JSONObject executed = AndroidActionExecutor.execute(
                            getApplicationContext(),
                            clientAction.optString("action"),
                            clientAction.optJSONObject("payload") == null ? new JSONObject() : clientAction.optJSONObject("payload")
                    );
                    return new JSONObject()
                            .put("ok", true)
                            .put("handled", true)
                            .put("state", "completed")
                            .put("scope", "android-local")
                            .put("confirmationId", result.optString("confirmationId", ""))
                            .put("result", executed);
                }
                return result;
            }
        } catch (Exception error) {
            try {
                return new JSONObject()
                        .put("ok", false)
                        .put("handled", true)
                        .put("state", "failed")
                        .put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            } catch (Exception ignored) {
                return new JSONObject();
            }
        }
    }

    private synchronized void sendNativeToolResponse(String id, String name, JSONObject result) {
        if (!nativeConversationActive || !liveReady.get() || liveSocket == null) return;
        try {
            JSONObject response = new JSONObject().put("name", name).put("response", result == null ? new JSONObject() : result);
            if (id != null && !id.isEmpty()) response.put("id", id);
            liveSocket.send(new JSONObject().put("toolResponse", new JSONObject()
                    .put("functionResponses", new JSONArray().put(response))).toString());
        } catch (Exception ignored) {}
    }

    private String mergeTranscript(String current, String incoming) {
        String next = incoming == null ? "" : incoming.trim();
        if (next.isEmpty()) return current == null ? "" : current;
        if (current == null || current.isEmpty()) return next;
        if (current.endsWith(next) || current.equals(next)) return current;
        if (next.startsWith(current)) return next;
        return (current + " " + next).replaceAll("\\s+", " ").trim();
    }

    private boolean isVoiceOffCommand(String text) {
        String v = normalize(text).replaceFirst("^sexta feira? ", "");
        return v.matches(".*(desativar|desative|desliga|desligue|desligar|encerrar|encerre|sair|parar) (o )?modo de voz.*")
                || v.matches(".*(desativar|desative|desliga|desligue|desligar) (a )?voz.*");
    }

    private void startLiveAudio() {
        if (audioRunning.getAndSet(true)) return;
        int minIn = AudioRecord.getMinBufferSize(INPUT_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        audioRecord = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, INPUT_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minIn * 2, 4096));
        int audioSessionId = audioRecord.getAudioSessionId();
        try {
            if (AcousticEchoCanceler.isAvailable()) {
                echoCanceler = AcousticEchoCanceler.create(audioSessionId);
                if (echoCanceler != null) echoCanceler.setEnabled(true);
            }
            if (NoiseSuppressor.isAvailable()) {
                noiseSuppressor = NoiseSuppressor.create(audioSessionId);
                if (noiseSuppressor != null) noiseSuppressor.setEnabled(true);
            }
        } catch (Exception ignored) {}
        int minOut = AudioTrack.getMinBufferSize(OUTPUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
        audioTrack = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(OUTPUT_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setBufferSizeInBytes(Math.max(minOut * 2, 8192))
                .setTransferMode(AudioTrack.MODE_STREAM).build();
        audioTrack.play();
        audioRecord.startRecording();
        captureThread = new Thread(() -> {
            byte[] buffer = new byte[3200];
            while (audioRunning.get() && nativeConversationActive) {
                int read = audioRecord.read(buffer, 0, buffer.length);
                // Full duplex: microphone frames continue while SEXTA speaks.
                // Gemini's START_OF_ACTIVITY_INTERRUPTS VAD performs barge-in;
                // Android's communication source and AEC reduce speaker echo.
                if (read <= 0 || !liveReady.get() || liveSocket == null) continue;
                try {
                    String b64 = Base64.encodeToString(buffer, 0, read, Base64.NO_WRAP);
                    JSONObject audio = new JSONObject().put("realtimeInput", new JSONObject().put("audio", new JSONObject().put("data", b64).put("mimeType", "audio/pcm;rate=" + INPUT_RATE)));
                    liveSocket.send(audio.toString());
                } catch (Exception ignored) {}
            }
        }, "sexta-live-capture");
        captureThread.start();
    }

    private synchronized void playPcm(byte[] pcm) {
        if (audioTrack == null || pcm == null || pcm.length == 0) return;
        assistantSpeaking.set(true);
        updateNotification("SEXTA ativa • falando...");
        audioTrack.write(pcm, 0, pcm.length, AudioTrack.WRITE_BLOCKING);
    }

    private void persistTurn(String userText, String assistantText) {
        if ((userText == null || userText.trim().isEmpty()) && (assistantText == null || assistantText.trim().isEmpty())) return;
        io.execute(() -> {
            try {
                JSONObject body = new JSONObject()
                        .put("conversationId", conversationId())
                        .put("deviceId", deviceId())
                        .put("userText", userText == null ? "" : userText.trim())
                        .put("assistantText", assistantText == null ? "" : assistantText.trim());
                Request req = authorized(BASE_URL + "/api/live-turn")
                        .post(RequestBody.create(body.toString(), MediaType.parse("application/json; charset=utf-8"))).build();
                try (Response ignored = http.newCall(req).execute()) {}
            } catch (Exception ignored) {}
        });
    }

    private synchronized void stopLiveAudio() {
        audioRunning.set(false);
        liveReady.set(false);
        if (echoCanceler != null) {
            try { echoCanceler.release(); } catch (Exception ignored) {}
            echoCanceler = null;
        }
        if (noiseSuppressor != null) {
            try { noiseSuppressor.release(); } catch (Exception ignored) {}
            noiseSuppressor = null;
        }
        if (audioRecord != null) {
            try { audioRecord.stop(); } catch (Exception ignored) {}
            try { audioRecord.release(); } catch (Exception ignored) {}
            audioRecord = null;
        }
        if (audioTrack != null) {
            try { audioTrack.stop(); } catch (Exception ignored) {}
            try { audioTrack.release(); } catch (Exception ignored) {}
            audioTrack = null;
        }
        assistantSpeaking.set(false);
    }

    private synchronized void finishNativeConversation(boolean byVoice) {
        if (!nativeConversationActive && liveSocket == null) return;
        nativeConversationActive = false;
        stopLiveAudio();
        if (liveSocket != null) {
            try { liveSocket.close(1000, byVoice ? "voice mode off" : "live ended"); } catch (Exception ignored) {}
            liveSocket = null;
        }
        inputTranscript = "";
        outputTranscript = "";
        pendingWakeCommand = "";
        updateNotification(byVoice ? "Modo de voz encerrado • aguardando “Sexta-feira”" : "Live encerrado • aguardando “Sexta-feira”");
        if (!webConversationActive) io.execute(() -> { try { Thread.sleep(350); } catch (InterruptedException ignored) {} startWakeListening(); });
    }

    private synchronized void stopEverything() {
        stopWakeListening();
        nativeConversationActive = false;
        stopLiveAudio();
        if (liveSocket != null) { try { liveSocket.close(1000, "service stopped"); } catch (Exception ignored) {} liveSocket = null; }
        if (wakeModel != null) { try { wakeModel.close(); } catch (Exception ignored) {} wakeModel = null; }
        getSharedPreferences("sexta_native", MODE_PRIVATE).edit().putBoolean("background_active", false).apply();
    }

    @Override public void onDestroy() {
        stopEverything();
        try { unregisterReceiver(conversationReceiver); } catch (Exception ignored) {}
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        io.shutdownNow();
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
