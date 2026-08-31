package com.sexta.assistant;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.accessibility.AccessibilityEvent;

public class SextaAccessibilityService extends AccessibilityService {
    private static volatile SextaAccessibilityService instance;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // v1: no UI scraping or automatic taps. This service is used only as a
        // user-enabled bridge for reliable Android actions such as opening apps.
    }

    @Override
    public void onInterrupt() {}

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    public static boolean isConnected() {
        return instance != null;
    }

    public static boolean launch(Intent intent) {
        SextaAccessibilityService service = instance;
        if (service == null || intent == null) return false;
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            service.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
