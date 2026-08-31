package com.sexta.assistant;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "LiveToolBridge")
public class LiveToolBridgePlugin extends Plugin {
    @PluginMethod
    public void execute(PluginCall call) {
        final String action = call.getString("action", "");
        final JSObject payload = call.getObject("payload", new JSObject());
        if (action == null || action.trim().isEmpty()) {
            JSObject out = new JSObject();
            out.put("ok", false);
            out.put("handled", true);
            out.put("error", "ANDROID_ACTION_REQUIRED");
            call.resolve(out);
            return;
        }

        final Context context = getContext().getApplicationContext();
        new Thread(() -> {
            JSObject out = new JSObject();
            try {
                JSONObject result = AndroidActionExecutor.execute(context, action.trim(), payload);
                out.put("ok", true);
                out.put("handled", true);
                out.put("action", action.trim());
                out.put("result", result);
            } catch (Exception error) {
                out.put("ok", false);
                out.put("handled", true);
                out.put("action", action.trim());
                out.put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            }
            call.resolve(out);
        }, "sexta-live-tool").start();
    }
}
