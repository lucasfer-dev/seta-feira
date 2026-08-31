package com.sexta.assistant;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class AndroidCommandLoop {
    private static final String BASE_URL = "https://seta-feira.vercel.app";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final AtomicBoolean STARTED = new AtomicBoolean(false);
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .writeTimeout(15, TimeUnit.SECONDS)
            .build();
    private static ScheduledExecutorService scheduler;

    private AndroidCommandLoop() {}

    public static void start(Context source) {
        if (source == null || !STARTED.compareAndSet(false, true)) return;
        Context context = source.getApplicationContext();
        scheduler = Executors.newSingleThreadScheduledExecutor();
        scheduler.scheduleWithFixedDelay(() -> tick(context), 1, 3, TimeUnit.SECONDS);
    }

    public static void stop() {
        STARTED.set(false);
        if (scheduler != null) {
            scheduler.shutdownNow();
            scheduler = null;
        }
    }

    private static String token(Context context) {
        return context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getString("owner_token", "");
    }

    private static String deviceId(Context context) {
        return context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getString("device_id", "android-native");
    }

    private static Request.Builder request(Context context, String path) {
        Request.Builder builder = new Request.Builder().url(BASE_URL + path).header("Content-Type", "application/json");
        String token = token(context);
        if (!token.isEmpty()) builder.header("Authorization", "Bearer " + token);
        return builder;
    }

    private static void tick(Context context) {
        try {
            if (token(context).isEmpty()) return;
            heartbeat(context);
            pollAndExecute(context);
            executeNewestSyncedVoiceCommand(context);
        } catch (Exception ignored) {}
    }

    private static void heartbeat(Context context) throws Exception {
        JSONObject body = new JSONObject()
                .put("deviceId", deviceId(context))
                .put("name", Build.MANUFACTURER + " " + Build.MODEL)
                .put("kind", "android")
                .put("capabilities", AndroidActionExecutor.capabilities())
                .put("context", new JSONObject()
                        .put("manufacturer", Build.MANUFACTURER)
                        .put("model", Build.MODEL)
                        .put("sdk", Build.VERSION.SDK_INT)
                        .put("notificationAccess", SextaNotificationListener.isListenerConnected()));
        try (Response ignored = HTTP.newCall(request(context, "/api/device-heartbeat")
                .post(RequestBody.create(body.toString(), JSON)).build()).execute()) {}
    }

    private static void pollAndExecute(Context context) throws Exception {
        String path = "/api/android-poll?deviceId=" + java.net.URLEncoder.encode(deviceId(context), "UTF-8");
        try (Response response = HTTP.newCall(request(context, path).get().build()).execute()) {
            if (!response.isSuccessful() || response.body() == null) return;
            JSONObject data = new JSONObject(response.body().string());
            JSONArray commands = data.optJSONArray("commands");
            if (commands == null) return;
            for (int i = 0; i < commands.length(); i++) {
                JSONObject command = commands.optJSONObject(i);
                if (command != null) executeAndReport(context, command);
            }
        }
    }

    private static void executeAndReport(Context context, JSONObject command) {
        String id = command.optString("id", "");
        String action = command.optString("action", "");
        JSONObject payload = command.optJSONObject("payload");
        if (payload == null) payload = new JSONObject();
        boolean ok = false;
        JSONObject result = new JSONObject();
        String message = "Executado pelo Android.";
        try {
            result = AndroidActionExecutor.execute(context, action, payload);
            ok = true;
        } catch (Exception error) {
            message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        }
        try {
            JSONObject body = new JSONObject()
                    .put("commandId", id)
                    .put("deviceId", deviceId(context))
                    .put("action", action)
                    .put("ok", ok)
                    .put("result", result)
                    .put("message", message);
            try (Response ignored = HTTP.newCall(request(context, "/api/android-result")
                    .post(RequestBody.create(body.toString(), JSON)).build()).execute()) {}
        } catch (Exception ignored) {}
    }

    private static String normalize(String value) {
        return Normalizer.normalize(String.valueOf(value == null ? "" : value), Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static void executeNewestSyncedVoiceCommand(Context context) {
        try (Response response = HTTP.newCall(request(context, "/api/sync?conversationId=main").get().build()).execute()) {
            if (!response.isSuccessful() || response.body() == null) return;
            JSONArray messages = new JSONObject(response.body().string()).optJSONArray("messages");
            if (messages == null || messages.length() == 0) return;
            JSONObject newest = null;
            for (int i = messages.length() - 1; i >= 0; i--) {
                JSONObject item = messages.optJSONObject(i);
                if (item != null && "user".equals(item.optString("role"))) { newest = item; break; }
            }
            if (newest == null) return;
            String id = newest.optString("id", "");
            if (id.isEmpty()) return;
            String last = context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getString("last_android_voice_action_message", "");
            if (id.equals(last)) return;

            JSONObject command = inferLocalAction(newest.optString("content", ""));
            context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit().putString("last_android_voice_action_message", id).apply();
            if (command == null) return;
            String action = command.optString("action", "");
            JSONObject payload = command.optJSONObject("payload");
            if (payload == null) payload = new JSONObject();
            AndroidActionExecutor.execute(context, action, payload);
        } catch (Exception ignored) {}
    }

    private static JSONObject inferLocalAction(String text) throws Exception {
        String raw = String.valueOf(text == null ? "" : text).trim();
        String t = normalize(raw);
        if (t.isEmpty()) return null;

        Matcher reply = Pattern.compile("(?i)\\b(?:responde|responder|responda)\\s+(?:no\\s+whatsapp\\s+)?(?:a|ao|o|pra|para)?\\s*([^,.:]+?)\\s+(?:no\\s+whatsapp\\s+)?(?:dizendo|falando|com|que)\\s+(.+)$").matcher(raw);
        if (reply.find()) return command("notification_reply", new JSONObject().put("package", "whatsapp").put("recipient", reply.group(1).trim()).put("text", reply.group(2).trim()));

        Matcher lastReply = Pattern.compile("(?i)\\b(?:responde|responder|responda)\\s+(?:a\\s+)?(?:ultima|última)\\s+(?:mensagem|notificacao|notificação)(?:\\s+do\\s+whatsapp)?\\s+(?:dizendo|falando|com|que)\\s+(.+)$").matcher(raw);
        if (lastReply.find()) return command("notification_reply", new JSONObject().put("package", "whatsapp").put("text", lastReply.group(1).trim()));

        if (t.matches(".*\\b(proxima|pula|pular)\\b.*\\b(musica|faixa).*")) return command("media_next", new JSONObject());
        if (t.matches(".*\\b(volta|anterior)\\b.*\\b(musica|faixa).*")) return command("media_previous", new JSONObject());
        if (t.matches(".*\\b(pausa|pause|toca|toque|play|continua)\\b.*")) return command("media_play_pause", new JSONObject());

        Matcher volume = Pattern.compile("(?i)\\bvolume\\b.*?(\\d{1,3})\\s*%?").matcher(t);
        if (volume.find()) return command("volume_set", new JSONObject().put("percent", Math.max(0, Math.min(100, Integer.parseInt(volume.group(1))))));
        if (t.matches(".*\\b(aumenta|sobe)\\b.*\\bvolume\\b.*") || t.matches(".*\\bvolume\\b.*\\b(aumenta|sobe)\\b.*")) return command("volume_adjust", new JSONObject().put("direction", "up"));
        if (t.matches(".*\\b(abaixa|diminui|reduz)\\b.*\\bvolume\\b.*") || t.matches(".*\\bvolume\\b.*\\b(abaixa|diminui|reduz)\\b.*")) return command("volume_adjust", new JSONObject().put("direction", "down"));

        if (t.matches(".*\\b(liga|acende)\\b.*\\b(lanterna|flash)\\b.*")) return command("flashlight", new JSONObject().put("enabled", true));
        if (t.matches(".*\\b(desliga|apaga)\\b.*\\b(lanterna|flash)\\b.*")) return command("flashlight", new JSONObject().put("enabled", false));

        if (t.matches(".*\\b(abre|abrir|abra)\\b.*")) {
            String[] apps = {"whatsapp business","whatsapp","spotify","youtube","instagram","telegram","discord","gmail","google maps","maps","drive","google fotos","fotos","camera","calculadora","calendario","agenda","mensagens","telefone"};
            for (String app : apps) if (t.contains(app)) return command("open_app", new JSONObject().put("app", app));
        }
        return null;
    }

    private static JSONObject command(String action, JSONObject payload) throws Exception {
        return new JSONObject().put("action", action).put("payload", payload);
    }
}
