package com.sexta.assistant;

import android.app.Notification;
import android.content.Context;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

public class SextaNotificationListener extends NotificationListenerService {
    private static final int MAX_ITEMS = 40;

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.getNotification() == null) return;
        if (getPackageName().equals(sbn.getPackageName())) return;
        try {
            Notification notification = sbn.getNotification();
            Bundle extras = notification.extras;
            String title = String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE, ""));
            String text = String.valueOf(extras.getCharSequence(Notification.EXTRA_TEXT, ""));
            if (title.trim().isEmpty() && text.trim().isEmpty()) return;

            JSONObject item = new JSONObject()
                    .put("package", sbn.getPackageName())
                    .put("title", title)
                    .put("text", text)
                    .put("postedAt", sbn.getPostTime());

            Context context = getApplicationContext();
            String raw = context.getSharedPreferences("sexta_native", MODE_PRIVATE).getString("recent_notifications", "[]");
            JSONArray current = new JSONArray(raw == null ? "[]" : raw);
            JSONArray next = new JSONArray();
            next.put(item);
            for (int i = 0; i < Math.min(current.length(), MAX_ITEMS - 1); i++) next.put(current.getJSONObject(i));
            context.getSharedPreferences("sexta_native", MODE_PRIVATE).edit().putString("recent_notifications", next.toString()).apply();
        } catch (Exception ignored) {}
    }
}
