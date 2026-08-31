package com.sexta.assistant;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class AndroidCommandLoop {
    private static final String BASE_URL = "https://seta-feira.vercel.app";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final AtomicBoolean STARTED = new AtomicBoolean(false);
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

    private static OkHttpClient http() {
        return new OkHttpClient.Builder()
                .connectTimeout(12, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .writeTimeout(15, TimeUnit.SECONDS)
                .build();
    }

    private static Request.Builder request(Context context, String path) {
        Request.Builder builder = new Request.Builder().url(BASE_URL + path).header("Content-Type", "application/json");
        String token = token(context);
        if (!token.isEmpty()) builder.header("Authorization", "Bearer " + token);
        return builder;
    }

    private static void tick(Context context) {
        try {
            String auth = token(context);
            if (auth.isEmpty()) return;
            heartbeat(context);
            pollAndExecute(context);
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
        try (Response ignored = http().newCall(request(context, "/api/device-heartbeat")
                .post(RequestBody.create(body.toString(), JSON)).build()).execute()) {}
    }

    private static void pollAndExecute(Context context) throws Exception {
        String path = "/api/android-poll?deviceId=" + java.net.URLEncoder.encode(deviceId(context), "UTF-8");
        try (Response response = http().newCall(request(context, path).get().build()).execute()) {
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
            try (Response ignored = http().newCall(request(context, "/api/android-result")
                    .post(RequestBody.create(body.toString(), JSON)).build()).execute()) {}
        } catch (Exception ignored) {}
    }
}
