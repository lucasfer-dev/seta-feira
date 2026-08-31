package com.sexta.assistant;

import android.app.NotificationManager;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.media.AudioManager;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.Settings;
import android.view.KeyEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class AndroidActionExecutor {
    private AndroidActionExecutor() {}

    private static final Map<String, String[]> APP_PACKAGES = new LinkedHashMap<>();
    static {
        APP_PACKAGES.put("whatsapp", new String[]{"com.whatsapp", "com.whatsapp.w4b"});
        APP_PACKAGES.put("whatsapp business", new String[]{"com.whatsapp.w4b", "com.whatsapp"});
        APP_PACKAGES.put("spotify", new String[]{"com.spotify.music"});
        APP_PACKAGES.put("youtube", new String[]{"com.google.android.youtube"});
        APP_PACKAGES.put("chrome", new String[]{"com.android.chrome"});
        APP_PACKAGES.put("navegador", new String[]{"com.android.chrome"});
        APP_PACKAGES.put("gmail", new String[]{"com.google.android.gm"});
        APP_PACKAGES.put("maps", new String[]{"com.google.android.apps.maps"});
        APP_PACKAGES.put("google maps", new String[]{"com.google.android.apps.maps"});
        APP_PACKAGES.put("instagram", new String[]{"com.instagram.android"});
        APP_PACKAGES.put("telegram", new String[]{"org.telegram.messenger"});
        APP_PACKAGES.put("discord", new String[]{"com.discord"});
        APP_PACKAGES.put("drive", new String[]{"com.google.android.apps.docs"});
        APP_PACKAGES.put("google drive", new String[]{"com.google.android.apps.docs"});
        APP_PACKAGES.put("fotos", new String[]{"com.google.android.apps.photos"});
        APP_PACKAGES.put("google fotos", new String[]{"com.google.android.apps.photos"});
        APP_PACKAGES.put("calendario", new String[]{"com.google.android.calendar"});
        APP_PACKAGES.put("agenda", new String[]{"com.google.android.calendar"});
        APP_PACKAGES.put("mensagens", new String[]{"com.google.android.apps.messaging"});
        APP_PACKAGES.put("telefone", new String[]{"com.google.android.dialer", "com.android.dialer"});
        APP_PACKAGES.put("calculadora", new String[]{"com.google.android.calculator", "com.android.calculator2"});
    }

    public static JSONArray capabilities() {
        return new JSONArray()
                .put("open_app")
                .put("open_url")
                .put("notification_list")
                .put("notification_reply")
                .put("media_play_pause")
                .put("media_next")
                .put("media_previous")
                .put("volume_set")
                .put("volume_adjust")
                .put("flashlight")
                .put("share_text")
                .put("dial")
                .put("sms_compose")
                .put("open_settings")
                .put("device_info");
    }

    public static JSONObject execute(Context context, String action, JSONObject payload) throws Exception {
        if (context == null) throw new IllegalArgumentException("ANDROID_CONTEXT_MISSING");
        if (payload == null) payload = new JSONObject();
        switch (String.valueOf(action)) {
            case "open_app": return openApp(context, payload);
            case "open_url": return openUrl(context, payload);
            case "notification_list": return listNotifications(context, payload);
            case "notification_reply": return SextaNotificationListener.reply(payload);
            case "media_play_pause": return mediaKey(context, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, "play_pause");
            case "media_next": return mediaKey(context, KeyEvent.KEYCODE_MEDIA_NEXT, "next");
            case "media_previous": return mediaKey(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS, "previous");
            case "volume_set": return volumeSet(context, payload);
            case "volume_adjust": return volumeAdjust(context, payload);
            case "flashlight": return flashlight(context, payload);
            case "share_text": return shareText(context, payload);
            case "dial": return dial(context, payload);
            case "sms_compose": return smsCompose(context, payload);
            case "open_settings": return openSettings(context, payload);
            case "device_info": return deviceInfo(context);
            default: throw new IllegalArgumentException("ANDROID_ACTION_NOT_ALLOWED");
        }
    }

    private static String normalize(String value) {
        return Normalizer.normalize(String.valueOf(value == null ? "" : value), Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static void launch(Context context, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    private static JSONObject openApp(Context context, JSONObject payload) throws Exception {
        String requested = normalize(payload.optString("app", payload.optString("package", "")));
        if (requested.isEmpty()) throw new IllegalArgumentException("ANDROID_APP_REQUIRED");
        if (requested.equals("camera")) {
            Intent camera = new Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA);
            launch(context, camera);
            return new JSONObject().put("opened", "camera");
        }
        if (requested.equals("configuracoes") || requested.equals("settings")) {
            return openSettings(context, payload);
        }

        List<String> candidates = new ArrayList<>();
        if (requested.contains(".")) candidates.add(requested);
        String[] aliases = APP_PACKAGES.get(requested);
        if (aliases != null) for (String name : aliases) candidates.add(name);

        PackageManager pm = context.getPackageManager();
        for (String packageName : candidates) {
            Intent launch = pm.getLaunchIntentForPackage(packageName);
            if (launch != null) {
                launch(context, launch);
                return new JSONObject().put("app", requested).put("package", packageName).put("opened", true);
            }
        }
        throw new IllegalArgumentException("ANDROID_APP_NOT_FOUND: " + requested);
    }

    private static JSONObject openUrl(Context context, JSONObject payload) throws Exception {
        String raw = payload.optString("url", "").trim();
        Uri uri = Uri.parse(raw);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https")) throw new IllegalArgumentException("ANDROID_URL_BLOCKED");
        launch(context, new Intent(Intent.ACTION_VIEW, uri));
        return new JSONObject().put("opened", raw);
    }

    private static JSONObject listNotifications(Context context, JSONObject payload) throws Exception {
        String packageFilter = payload.optString("package", "").trim();
        int limit = Math.max(1, Math.min(40, payload.optInt("limit", 12)));
        String raw = context.getSharedPreferences("sexta_native", Context.MODE_PRIVATE).getString("recent_notifications", "[]");
        JSONArray source = new JSONArray(raw == null ? "[]" : raw);
        JSONArray items = new JSONArray();
        for (int i = 0; i < source.length() && items.length() < limit; i++) {
            JSONObject item = source.optJSONObject(i);
            if (item == null) continue;
            if (!packageFilter.isEmpty() && !packageMatches(item.optString("package", ""), packageFilter)) continue;
            items.put(item);
        }
        return new JSONObject().put("notifications", items).put("count", items.length());
    }

    static boolean packageMatches(String actual, String requested) {
        String wanted = normalize(requested);
        if (wanted.isEmpty()) return true;
        if (actual.equals(requested)) return true;
        if (wanted.equals("whatsapp")) return actual.equals("com.whatsapp") || actual.equals("com.whatsapp.w4b");
        String[] aliases = APP_PACKAGES.get(wanted);
        if (aliases != null) for (String value : aliases) if (actual.equals(value)) return true;
        return false;
    }

    private static JSONObject mediaKey(Context context, int keyCode, String command) throws Exception {
        try {
            MediaSessionManager manager = (MediaSessionManager) context.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> sessions = manager.getActiveSessions(new ComponentName(context, SextaNotificationListener.class));
            if (sessions != null && !sessions.isEmpty()) {
                MediaController controller = sessions.get(0);
                MediaController.TransportControls controls = controller.getTransportControls();
                if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT) controls.skipToNext();
                else if (keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS) controls.skipToPrevious();
                else {
                    int state = controller.getPlaybackState() == null ? -1 : controller.getPlaybackState().getState();
                    if (state == android.media.session.PlaybackState.STATE_PLAYING || state == android.media.session.PlaybackState.STATE_BUFFERING) controls.pause();
                    else controls.play();
                }
                return new JSONObject().put("media", command).put("package", controller.getPackageName()).put("via", "media_session");
            }
        } catch (SecurityException ignored) {}

        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, keyCode));
        audio.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, keyCode));
        return new JSONObject().put("media", command).put("via", "media_key");
    }

    private static JSONObject volumeSet(Context context, JSONObject payload) throws Exception {
        int percent = Math.max(0, Math.min(100, payload.optInt("percent", payload.optInt("value", 50))));
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int value = Math.round(max * (percent / 100f));
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, value, AudioManager.FLAG_SHOW_UI);
        return new JSONObject().put("percent", percent).put("value", value).put("max", max);
    }

    private static JSONObject volumeAdjust(Context context, JSONObject payload) throws Exception {
        String direction = normalize(payload.optString("direction", "up"));
        int adjust = direction.startsWith("down") || direction.startsWith("baix") || direction.startsWith("diminu")
                ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_RAISE;
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, adjust, AudioManager.FLAG_SHOW_UI);
        int value = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return new JSONObject().put("direction", adjust == AudioManager.ADJUST_LOWER ? "down" : "up")
                .put("percent", max == 0 ? 0 : Math.round(value * 100f / max));
    }

    private static JSONObject flashlight(Context context, JSONObject payload) throws Exception {
        boolean enabled = payload.has("enabled") ? payload.optBoolean("enabled") : !payload.optString("state", "on").equalsIgnoreCase("off");
        CameraManager cameraManager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        for (String id : cameraManager.getCameraIdList()) {
            CameraCharacteristics c = cameraManager.getCameraCharacteristics(id);
            Boolean flash = c.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            Integer facing = c.get(CameraCharacteristics.LENS_FACING);
            if (Boolean.TRUE.equals(flash) && (facing == null || facing == CameraCharacteristics.LENS_FACING_BACK)) {
                cameraManager.setTorchMode(id, enabled);
                return new JSONObject().put("flashlight", enabled).put("cameraId", id);
            }
        }
        throw new IllegalArgumentException("ANDROID_FLASHLIGHT_NOT_AVAILABLE");
    }

    private static JSONObject shareText(Context context, JSONObject payload) throws Exception {
        String text = payload.optString("text", "").trim();
        if (text.isEmpty()) throw new IllegalArgumentException("ANDROID_SHARE_TEXT_REQUIRED");
        Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
        String packageName = payload.optString("package", "").trim();
        if (!packageName.isEmpty()) send.setPackage(packageName);
        Intent chooser = packageName.isEmpty() ? Intent.createChooser(send, "Compartilhar com") : send;
        launch(context, chooser);
        return new JSONObject().put("shared", true).put("length", text.length());
    }

    private static JSONObject dial(Context context, JSONObject payload) throws Exception {
        String number = payload.optString("number", "").replaceAll("[^0-9+]", "");
        if (number.isEmpty()) throw new IllegalArgumentException("ANDROID_PHONE_REQUIRED");
        launch(context, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))));
        return new JSONObject().put("dialer", true).put("number", number);
    }

    private static JSONObject smsCompose(Context context, JSONObject payload) throws Exception {
        String number = payload.optString("number", "").replaceAll("[^0-9+]", "");
        String text = payload.optString("text", "");
        Intent sms = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number)));
        sms.putExtra("sms_body", text);
        launch(context, sms);
        return new JSONObject().put("sms", true).put("number", number).put("length", text.length());
    }

    private static JSONObject openSettings(Context context, JSONObject payload) throws Exception {
        String section = normalize(payload.optString("section", ""));
        Intent intent;
        if (section.contains("wifi")) intent = new Intent(Settings.ACTION_WIFI_SETTINGS);
        else if (section.contains("bluetooth")) intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        else if (section.contains("notific")) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else intent = new Intent(Settings.ACTION_SETTINGS);
        launch(context, intent);
        return new JSONObject().put("settings", section.isEmpty() ? "general" : section);
    }

    private static JSONObject deviceInfo(Context context) throws Exception {
        BatteryManager battery = (BatteryManager) context.getSystemService(Context.BATTERY_SERVICE);
        int batteryPercent = battery == null ? -1 : battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
        AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        BluetoothManager btManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        BluetoothAdapter bt = btManager == null ? null : btManager.getAdapter();
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return new JSONObject()
                .put("manufacturer", Build.MANUFACTURER)
                .put("model", Build.MODEL)
                .put("sdk", Build.VERSION.SDK_INT)
                .put("batteryPercent", batteryPercent)
                .put("musicVolume", audio == null ? -1 : audio.getStreamVolume(AudioManager.STREAM_MUSIC))
                .put("bluetoothEnabled", bt != null && bt.isEnabled())
                .put("doNotDisturbAccess", nm != null && nm.isNotificationPolicyAccessGranted());
    }
}
