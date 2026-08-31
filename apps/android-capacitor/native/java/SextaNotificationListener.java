package com.sexta.assistant;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.Locale;

public class SextaNotificationListener extends NotificationListenerService {
    private static final int MAX_ITEMS = 40;
    private static volatile SextaNotificationListener INSTANCE;

    public static boolean isListenerConnected() { return INSTANCE != null; }

    @Override public void onListenerConnected() {
        super.onListenerConnected();
        INSTANCE = this;
        AndroidCommandLoop.start(this);
    }

    @Override public void onListenerDisconnected() {
        INSTANCE = null;
        super.onListenerDisconnected();
    }

    @Override public void onDestroy() {
        if (INSTANCE == this) INSTANCE = null;
        super.onDestroy();
    }

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
                    .put("key", sbn.getKey())
                    .put("package", sbn.getPackageName())
                    .put("title", title)
                    .put("text", text)
                    .put("replyable", findReplyAction(notification) != null)
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

    private static String normalize(String value) {
        return Normalizer.normalize(String.valueOf(value == null ? "" : value), Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static Notification.Action findReplyAction(Notification notification) {
        if (notification == null || notification.actions == null) return null;
        for (Notification.Action action : notification.actions) {
            if (action == null || action.actionIntent == null) continue;
            RemoteInput[] inputs = action.getRemoteInputs();
            if (inputs != null && inputs.length > 0) return action;
        }
        return null;
    }

    private static boolean textMatches(StatusBarNotification sbn, String recipient) {
        if (recipient == null || recipient.trim().isEmpty()) return true;
        String wanted = normalize(recipient);
        Bundle extras = sbn.getNotification().extras;
        String title = normalize(String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE, "")));
        String text = normalize(String.valueOf(extras.getCharSequence(Notification.EXTRA_TEXT, "")));
        return title.contains(wanted) || text.contains(wanted);
    }

    public static JSONObject reply(JSONObject payload) throws Exception {
        SextaNotificationListener service = INSTANCE;
        if (service == null) throw new IllegalStateException("ANDROID_NOTIFICATION_ACCESS_REQUIRED");
        String message = payload == null ? "" : payload.optString("text", payload.optString("message", "")).trim();
        String recipient = payload == null ? "" : payload.optString("recipient", payload.optString("sender", "")).trim();
        String packageFilter = payload == null ? "whatsapp" : payload.optString("package", "whatsapp").trim();
        String requestedKey = payload == null ? "" : payload.optString("key", "").trim();
        if (message.isEmpty()) throw new IllegalArgumentException("ANDROID_REPLY_TEXT_REQUIRED");

        StatusBarNotification selected = null;
        Notification.Action selectedAction = null;
        StatusBarNotification[] active = service.getActiveNotifications();
        if (active != null) {
            for (StatusBarNotification sbn : active) {
                if (sbn == null || sbn.getNotification() == null) continue;
                if (!requestedKey.isEmpty() && !requestedKey.equals(sbn.getKey())) continue;
                if (!AndroidActionExecutor.packageMatches(sbn.getPackageName(), packageFilter)) continue;
                if (!textMatches(sbn, recipient)) continue;
                Notification.Action action = findReplyAction(sbn.getNotification());
                if (action == null) continue;
                if (selected == null || sbn.getPostTime() > selected.getPostTime()) {
                    selected = sbn;
                    selectedAction = action;
                }
            }
        }
        if (selected == null || selectedAction == null) throw new IllegalArgumentException("ANDROID_REPLYABLE_NOTIFICATION_NOT_FOUND");

        RemoteInput[] remoteInputs = selectedAction.getRemoteInputs();
        Bundle results = new Bundle();
        for (RemoteInput remoteInput : remoteInputs) results.putCharSequence(remoteInput.getResultKey(), message);
        Intent fillIn = new Intent();
        RemoteInput.addResultsToIntent(remoteInputs, fillIn, results);
        try {
            selectedAction.actionIntent.send(service, 0, fillIn);
        } catch (PendingIntent.CanceledException error) {
            throw new IllegalStateException("ANDROID_REPLY_ACTION_EXPIRED");
        }

        Bundle extras = selected.getNotification().extras;
        return new JSONObject()
                .put("sent", true)
                .put("package", selected.getPackageName())
                .put("recipient", String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE, recipient)))
                .put("key", selected.getKey())
                .put("length", message.length());
    }
}
