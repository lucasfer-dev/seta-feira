package com.sexta.assistant;

import org.json.JSONObject;

/**
 * Conservative accessibility-backed navigation for SEXTA Hands v1.
 *
 * The generic layer can inspect and navigate an interface, but final sensitive
 * controls (send/pay/buy/delete/confirm/post/transfer) are blocked inside
 * SextaAccessibilityService. Sensitive effects remain the job of dedicated
 * tools with explicit user intent and auditable semantics.
 */
public final class AndroidHandsExecutor {
    private AndroidHandsExecutor() {}

    public static JSONObject execute(String action, JSONObject payload) throws Exception {
        if (payload == null) payload = new JSONObject();
        switch (String.valueOf(action)) {
            case "ui_snapshot":
                return SextaAccessibilityService.snapshot();
            case "ui_tap_text":
                return SextaAccessibilityService.tapText(payload.optString("text", ""));
            case "ui_scroll":
                return SextaAccessibilityService.scroll(payload.optString("direction", "down"));
            case "ui_back":
                return SextaAccessibilityService.globalBack();
            case "ui_home":
                return SextaAccessibilityService.globalHome();
            default:
                throw new IllegalArgumentException("ANDROID_HANDS_ACTION_NOT_ALLOWED");
        }
    }
}
