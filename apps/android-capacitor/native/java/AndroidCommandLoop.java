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

    public static JSONObject executeTextResult(Context context, String text) {
        JSONObject status = new JSONObject();
        JSONObject command = null;
        try {
            status.put("text", String.valueOf(text == null ? "" : text));
            if (context == null) {
                return status.put("handled", false).put("ok", false).put("message", "ANDROID_CONTEXT_MISSING");
            }
            command = inferLocalAction(text);
            if (command == null) {
                return status.put("handled", false).put("ok", false).put("message", "ANDROID_ACTION_NOT_RECOGNIZED");
            }

            String action = command.optString("action", "");
            JSONObject payload = command.optJSONObject("payload");
            if (payload == null) payload = new JSONObject();
            status.put("handled", true).put("action", action).put("payload", payload);

            JSONObject result = AndroidActionExecutor.execute(context, action, payload);
            status.put("ok", true).put("result", result).put("message", "Executado pelo Android.");
            context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit()
                    .putString("last_android_direct_text", normalize(text))
                    .putLong("last_android_direct_at", System.currentTimeMillis())
                    .putString("last_android_action_status", status.toString())
                    .putLong("last_android_action_at", System.currentTimeMillis())
                    .apply();
            return status;
        } catch (Exception error) {
            try {
                boolean handled = command != null;
                String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                status.put("handled", handled).put("ok", false).put("message", message);
                if (command != null) status.put("action", command.optString("action", ""));
                if (context != null) {
                    context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit()
                            .putString("last_android_action_status", status.toString())
                            .putLong("last_android_action_at", System.currentTimeMillis())
                            .apply();
                }
            } catch (Exception ignored) {}
            return status;
        }
    }

    public static boolean executeText(Context context, String text) {
        JSONObject status = executeTextResult(context, text);
        return status.optBoolean("handled", false) && status.optBoolean("ok", false);
    }

    private static String token(Context context) {
        return SecureTokenStore.getOwnerToken(context);
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
                        .put("notificationAccess", SextaNotificationListener.isListenerConnected())
                        .put("accessibilityConnected", SextaAccessibilityService.isConnected()));
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

            String content = newest.optString("content", "");
            String normalized = normalize(content);
            String direct = context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getString("last_android_direct_text", "");
            long directAt = context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getLong("last_android_direct_at", 0L);
            context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit().putString("last_android_voice_action_message", id).apply();
            if (normalized.equals(direct) && System.currentTimeMillis() - directAt < 20000L) return;
            executeTextResult(context, content);
        } catch (Exception ignored) {}
    }

    private static JSONObject inferLocalAction(String text) throws Exception {
        String raw = String.valueOf(text == null ? "" : text).trim();
        String t = normalize(raw);
        if (t.isEmpty()) return null;

        // Explicit PC commands must never execute on Android.
        if (t.matches(".*\\b(no|pro|para o|do)\\s+(pc|computador|windows|notebook)\\b.*")) return null;

        // Replies send external content. Route them through the cloud Tool Bus
        // so the confirmation and idempotency gate runs before Android acts.
        if (t.matches(".*\\b(responde|responder|responda)\\b.*")) return null;

        if (t.matches(".*\\b(proxima|pula|pular)\\b.*\\b(musica|faixa).*")) return command("media_next", new JSONObject());
        if (t.matches(".*\\b(volta|anterior)\\b.*\\b(musica|faixa).*")) return command("media_previous", new JSONObject());
        if (t.matches(".*\\b(pausa|pause|toca|toque|play|continua)\\b.*")) return command("media_play_pause", new JSONObject());

        Matcher volume = Pattern.compile("(?i)\\bvolume\\b.*?(\\d{1,3})\\s*%?").matcher(t);
        if (volume.find()) return command("volume_set", new JSONObject().put("percent", Math.max(0, Math.min(100, Integer.parseInt(volume.group(1))))));
        if (t.matches(".*\\b(aumenta|sobe)\\b.*\\bvolume\\b.*") || t.matches(".*\\bvolume\\b.*\\b(aumenta|sobe)\\b.*")) return command("volume_adjust", new JSONObject().put("direction", "up"));
        if (t.matches(".*\\b(abaixa|diminui|reduz)\\b.*\\bvolume\\b.*") || t.matches(".*\\bvolume\\b.*\\b(abaixa|diminui|reduz)\\b.*")) return command("volume_adjust", new JSONObject().put("direction", "down"));

        if (t.matches(".*\\b(liga|acende)\\b.*\\b(lanterna|flash)\\b.*")) return command("flashlight", new JSONObject().put("enabled", true));
        if (t.matches(".*\\b(desliga|apaga)\\b.*\\b(lanterna|flash)\\b.*")) return command("flashlight", new JSONObject().put("enabled", false));

        Matcher open = Pattern.compile("(?i)\\b(?:abre|abrir|abra|inicia|iniciar|abre ai|abre aí)\\s+(?:o\\s+|a\\s+|app\\s+|aplicativo\\s+)?(.+)$").matcher(t);
        if (open.find()) {
            String app = open.group(1)
                    .replaceAll("\\s+(?:no|nesse|neste)\\s+(?:celular|android|telefone).*$", "")
                    .replaceAll("\\s+(?:pra mim|para mim|por favor|pfv|prfv)$", "")
                    .trim();
            if (app.equals("wpp") || app.equals("zap") || app.equals("zap zap") || app.equals("whats") || app.equals("whats app")) app = "whatsapp";
            if (!app.isEmpty() && !app.matches("^(?:link|site|pagina|página|arquivo)$")) {
                return command("open_app", new JSONObject().put("app", app));
            }
        }
        return null;
    }

    private static JSONObject command(String action, JSONObject payload) throws Exception {
        return new JSONObject().put("action", action).put("payload", payload);
    }
}
