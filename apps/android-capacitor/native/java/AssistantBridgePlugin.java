package com.sexta.assistant;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@CapacitorPlugin(name = "AssistantBridge")
public class AssistantBridgePlugin extends Plugin {
    private static final int PERMISSION_REQUEST = 9440;

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean notificationAccessGranted() {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        return enabled != null && enabled.contains(getContext().getPackageName());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("microphone", granted(Manifest.permission.RECORD_AUDIO));
        out.put("notifications", Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS));
        out.put("camera", granted(Manifest.permission.CAMERA));
        out.put("contacts", granted(Manifest.permission.READ_CONTACTS));
        out.put("calendar", granted(Manifest.permission.READ_CALENDAR));
        out.put("bluetooth", Build.VERSION.SDK_INT < 31 || granted(Manifest.permission.BLUETOOTH_CONNECT));
        out.put("notificationAccess", notificationAccessGranted());
        out.put("backgroundActive", getContext().getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getBoolean("background_active", false));
        out.put("platform", "android");
        out.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(out);
    }

    @PluginMethod
    public void setSession(PluginCall call) {
        String token = call.getString("token", "");
        String conversationId = call.getString("conversationId", "main");
        String deviceId = call.getString("deviceId", "android-native");
        SecureTokenStore.saveOwnerToken(getContext(), token);
        getContext().getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit()
                .putString("conversation_id", conversationId == null ? "main" : conversationId)
                .putString("device_id", deviceId == null ? "android-native" : deviceId)
                .apply();
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void executeVoiceCommand(PluginCall call) {
        String text = call.getString("text", "");
        if (text == null || text.trim().isEmpty()) {
            call.reject("VOICE_COMMAND_REQUIRED");
            return;
        }

        final Context context = getContext().getApplicationContext();
        final String commandText = text.trim();
        new Thread(() -> {
            try {
                JSONObject result = AndroidCommandLoop.executeTextResult(context, commandText);
                String provider = "android";
                if (!result.optBoolean("handled", false)) {
                    result = CloudVoiceActionBridge.execute(context, commandText);
                    provider = result.optString("provider", "cloud");
                }

                JSObject out = new JSObject();
                out.put("handled", result.optBoolean("handled", false));
                out.put("ok", result.optBoolean("ok", false));
                out.put("provider", result.optString("provider", provider));
                out.put("action", result.optString("action", ""));
                out.put("reply", result.optString("reply", result.optString("message", "")));
                out.put("message", result.optString("message", ""));
                if (result.has("result")) out.put("result", result.opt("result"));
                if (result.has("needsGoogleConnect")) out.put("needsGoogleConnect", result.optBoolean("needsGoogleConnect"));
                if (result.has("needsGoogleConfig")) out.put("needsGoogleConfig", result.optBoolean("needsGoogleConfig"));
                if (result.has("needsEvolutionConnect")) out.put("needsEvolutionConnect", result.optBoolean("needsEvolutionConnect"));
                call.resolve(out);
            } catch (Exception error) {
                JSObject out = new JSObject();
                out.put("handled", false);
                out.put("ok", false);
                out.put("message", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
                call.resolve(out);
            }
        }, "sexta-voice-command").start();
    }

    private void addCapabilityPermissions(String capability, Set<String> permissions) {
        if (capability == null) return;
        switch (capability) {
            case "microphone":
                permissions.add(Manifest.permission.RECORD_AUDIO);
                break;
            case "notifications":
                if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS);
                break;
            case "camera":
                permissions.add(Manifest.permission.CAMERA);
                break;
            case "contacts":
                permissions.add(Manifest.permission.READ_CONTACTS);
                permissions.add(Manifest.permission.WRITE_CONTACTS);
                break;
            case "calendar":
                permissions.add(Manifest.permission.READ_CALENDAR);
                permissions.add(Manifest.permission.WRITE_CALENDAR);
                break;
            case "bluetooth":
                if (Build.VERSION.SDK_INT >= 31) {
                    permissions.add(Manifest.permission.BLUETOOTH_CONNECT);
                    permissions.add(Manifest.permission.BLUETOOTH_SCAN);
                }
                break;
        }
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        JSArray requested = call.getArray("capabilities", new JSArray());
        Set<String> permissionSet = new LinkedHashSet<>();
        try {
            for (int i = 0; i < requested.length(); i++) addCapabilityPermissions(requested.getString(i), permissionSet);
        } catch (Exception ignored) {}

        List<String> missing = new ArrayList<>();
        for (String permission : permissionSet) if (!granted(permission)) missing.add(permission);
        if (!missing.isEmpty()) ActivityCompat.requestPermissions(getActivity(), missing.toArray(new String[0]), PERMISSION_REQUEST);

        JSObject result = new JSObject();
        result.put("requested", missing.size());
        call.resolve(result);
    }

    @PluginMethod
    public void startBackgroundAssistant(PluginCall call) {
        if (!granted(Manifest.permission.RECORD_AUDIO)) {
            List<String> ask = new ArrayList<>();
            ask.add(Manifest.permission.RECORD_AUDIO);
            if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) ask.add(Manifest.permission.POST_NOTIFICATIONS);
            ActivityCompat.requestPermissions(getActivity(), ask.toArray(new String[0]), PERMISSION_REQUEST);
            JSObject result = new JSObject();
            result.put("started", false);
            result.put("permissionsRequested", true);
            call.resolve(result);
            return;
        }
        Intent service = new Intent(getContext(), SextaForegroundService.class).setAction(SextaForegroundService.ACTION_START);
        ContextCompat.startForegroundService(getContext(), service);
        getContext().getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit().putBoolean("background_active", true).apply();
        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stopBackgroundAssistant(PluginCall call) {
        Intent service = new Intent(getContext(), SextaForegroundService.class).setAction(SextaForegroundService.ACTION_STOP);
        getContext().startService(service);
        getContext().getSharedPreferences("sexta_native", Context.MODE_PRIVATE).edit().putBoolean("background_active", false).apply();
        JSObject result = new JSObject();
        result.put("stopped", true);
        call.resolve(result);
    }

    @PluginMethod
    public void setConversationActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        Intent broadcast = new Intent(SextaForegroundService.ACTION_CONVERSATION_STATE)
                .setPackage(getContext().getPackageName())
                .putExtra(SextaForegroundService.EXTRA_ACTIVE, active);
        getContext().sendBroadcast(broadcast);
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", getContext().getPackageName(), null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getRecentNotifications(PluginCall call) {
        String raw = getContext().getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getString("recent_notifications", "[]");
        JSObject result = new JSObject();
        try {
            JSONArray source = new JSONArray(raw == null ? "[]" : raw);
            JSArray items = new JSArray();
            for (int i = 0; i < source.length(); i++) items.put(source.getJSONObject(i));
            result.put("notifications", items);
        } catch (Exception error) {
            result.put("notifications", new JSArray());
        }
        call.resolve(result);
    }
}
