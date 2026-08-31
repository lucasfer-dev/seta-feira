package com.sexta.assistant;

import android.content.Context;

import org.json.JSONObject;

import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public final class CloudVoiceActionBridge {
    private static final String BASE_URL = "https://seta-feira.vercel.app";
    private static final MediaType JSON = MediaType.parse("application/json; charset=utf-8");
    private static final OkHttpClient HTTP = new OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(18, TimeUnit.SECONDS)
            .writeTimeout(12, TimeUnit.SECONDS)
            .build();

    private CloudVoiceActionBridge() {}

    public static JSONObject execute(Context context, String text) {
        JSONObject fallback = new JSONObject();
        try {
            fallback.put("handled", false).put("ok", false);
            if (context == null || text == null || text.trim().isEmpty()) return fallback;

            String token = context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE)
                    .getString("owner_token", "");
            if (token == null || token.trim().isEmpty()) return fallback;

            String deviceId = context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE)
                    .getString("device_id", "android-native");

            JSONObject body = new JSONObject()
                    .put("text", text.trim())
                    .put("deviceId", deviceId);

            Request request = new Request.Builder()
                    .url(BASE_URL + "/api/voice-action")
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + token)
                    .post(RequestBody.create(body.toString(), JSON))
                    .build();

            try (Response response = HTTP.newCall(request).execute()) {
                if (response.body() == null) return fallback;
                String raw = response.body().string();
                JSONObject result = raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
                if (!response.isSuccessful()) {
                    return new JSONObject()
                            .put("handled", false)
                            .put("ok", false)
                            .put("message", result.optString("message", "CLOUD_ACTION_HTTP_" + response.code()));
                }
                return result;
            }
        } catch (Exception error) {
            try {
                return new JSONObject()
                        .put("handled", false)
                        .put("ok", false)
                        .put("message", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            } catch (Exception ignored) {
                return fallback;
            }
        }
    }
}
