package com.sexta.assistant;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class SextaAccessibilityService extends AccessibilityService {
    private static volatile SextaAccessibilityService instance;
    private static final int SNAPSHOT_MAX_NODES = 180;
    private static final int SNAPSHOT_MAX_DEPTH = 12;

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Hands v1 reads the active tree only on explicit tool requests. We do not
        // stream UI contents continuously and do not keep a background screen log.
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

    public static JSONObject snapshot() throws Exception {
        SextaAccessibilityService service = requireService();
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) throw new IllegalStateException("ANDROID_UI_ROOT_UNAVAILABLE");

        JSONArray nodes = new JSONArray();
        int[] count = new int[]{0};
        appendNode(root, nodes, 0, count);
        JSONObject out = new JSONObject()
                .put("connected", true)
                .put("count", nodes.length())
                .put("nodes", nodes);
        CharSequence pkg = root.getPackageName();
        if (pkg != null) out.put("package", String.valueOf(pkg));
        root.recycle();
        return out;
    }

    public static JSONObject tapText(String requested) throws Exception {
        SextaAccessibilityService service = requireService();
        String wanted = clean(requested);
        if (wanted.isEmpty()) throw new IllegalArgumentException("ANDROID_UI_TEXT_REQUIRED");
        if (isSensitiveControl(wanted)) throw new SecurityException("ANDROID_UI_SENSITIVE_CONTROL_BLOCKED");

        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) throw new IllegalStateException("ANDROID_UI_ROOT_UNAVAILABLE");

        List<AccessibilityNodeInfo> matches = new ArrayList<>();
        collectMatches(root, wanted, matches, 0);
        AccessibilityNodeInfo best = chooseBestMatch(matches, wanted);
        if (best == null) {
            recycleAll(matches);
            root.recycle();
            throw new IllegalArgumentException("ANDROID_UI_TEXT_NOT_FOUND");
        }

        AccessibilityNodeInfo clickable = clickableAncestor(best);
        boolean clicked = clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        String label = nodeLabel(best);
        if (clickable != null && clickable != best) clickable.recycle();
        recycleAll(matches);
        root.recycle();
        if (!clicked) throw new IllegalStateException("ANDROID_UI_TARGET_NOT_CLICKABLE");
        return new JSONObject().put("clicked", true).put("target", label);
    }

    public static JSONObject scroll(String direction) throws Exception {
        SextaAccessibilityService service = requireService();
        AccessibilityNodeInfo root = service.getRootInActiveWindow();
        if (root == null) throw new IllegalStateException("ANDROID_UI_ROOT_UNAVAILABLE");
        AccessibilityNodeInfo scrollable = firstScrollable(root, 0);
        if (scrollable == null) {
            root.recycle();
            throw new IllegalStateException("ANDROID_UI_SCROLL_TARGET_NOT_FOUND");
        }
        boolean backward = clean(direction).matches("up|back|backward|cima|voltar");
        int action = backward ? AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD : AccessibilityNodeInfo.ACTION_SCROLL_FORWARD;
        boolean ok = scrollable.performAction(action);
        if (scrollable != root) scrollable.recycle();
        root.recycle();
        if (!ok) throw new IllegalStateException("ANDROID_UI_SCROLL_FAILED");
        return new JSONObject().put("scrolled", true).put("direction", backward ? "up" : "down");
    }

    public static JSONObject globalBack() throws Exception {
        SextaAccessibilityService service = requireService();
        boolean ok = service.performGlobalAction(GLOBAL_ACTION_BACK);
        if (!ok) throw new IllegalStateException("ANDROID_UI_BACK_FAILED");
        return new JSONObject().put("back", true);
    }

    public static JSONObject globalHome() throws Exception {
        SextaAccessibilityService service = requireService();
        boolean ok = service.performGlobalAction(GLOBAL_ACTION_HOME);
        if (!ok) throw new IllegalStateException("ANDROID_UI_HOME_FAILED");
        return new JSONObject().put("home", true);
    }

    private static SextaAccessibilityService requireService() {
        SextaAccessibilityService service = instance;
        if (service == null) throw new IllegalStateException("ANDROID_ACCESSIBILITY_NOT_CONNECTED");
        return service;
    }

    private static void appendNode(AccessibilityNodeInfo node, JSONArray out, int depth, int[] count) throws Exception {
        if (node == null || depth > SNAPSHOT_MAX_DEPTH || count[0] >= SNAPSHOT_MAX_NODES) return;
        count[0] += 1;
        String text = node.isPassword() ? "" : safeText(node.getText());
        String description = safeText(node.getContentDescription());
        String viewId = safeText(node.getViewIdResourceName());
        String className = safeText(node.getClassName());

        if (!text.isEmpty() || !description.isEmpty() || node.isClickable() || node.isScrollable() || node.isEditable()) {
            Rect bounds = new Rect();
            node.getBoundsInScreen(bounds);
            JSONObject item = new JSONObject()
                    .put("depth", depth)
                    .put("text", text)
                    .put("description", description)
                    .put("class", className)
                    .put("clickable", node.isClickable())
                    .put("scrollable", node.isScrollable())
                    .put("editable", node.isEditable())
                    .put("enabled", node.isEnabled())
                    .put("bounds", new JSONArray().put(bounds.left).put(bounds.top).put(bounds.right).put(bounds.bottom));
            if (!viewId.isEmpty()) item.put("viewId", viewId);
            out.put(item);
        }

        int children = Math.min(node.getChildCount(), 60);
        for (int i = 0; i < children && count[0] < SNAPSHOT_MAX_NODES; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            appendNode(child, out, depth + 1, count);
            child.recycle();
        }
    }

    private static void collectMatches(AccessibilityNodeInfo node, String wanted, List<AccessibilityNodeInfo> out, int depth) {
        if (node == null || depth > SNAPSHOT_MAX_DEPTH || out.size() >= 40) return;
        String text = clean(node.isPassword() ? "" : safeText(node.getText()));
        String description = clean(safeText(node.getContentDescription()));
        if ((!text.isEmpty() && (text.equals(wanted) || text.contains(wanted) || wanted.contains(text)))
                || (!description.isEmpty() && (description.equals(wanted) || description.contains(wanted) || wanted.contains(description)))) {
            out.add(AccessibilityNodeInfo.obtain(node));
        }
        int children = Math.min(node.getChildCount(), 60);
        for (int i = 0; i < children; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            collectMatches(child, wanted, out, depth + 1);
            child.recycle();
        }
    }

    private static AccessibilityNodeInfo chooseBestMatch(List<AccessibilityNodeInfo> nodes, String wanted) {
        AccessibilityNodeInfo best = null;
        int bestScore = -1;
        for (AccessibilityNodeInfo node : nodes) {
            String text = clean(node.isPassword() ? "" : safeText(node.getText()));
            String description = clean(safeText(node.getContentDescription()));
            String value = !text.isEmpty() ? text : description;
            int score = value.equals(wanted) ? 100 : value.startsWith(wanted) ? 80 : value.contains(wanted) ? 60 : wanted.contains(value) ? 45 : 0;
            if (node.isClickable()) score += 15;
            if (node.isEnabled()) score += 5;
            if (score > bestScore) { bestScore = score; best = node; }
        }
        return best;
    }

    private static AccessibilityNodeInfo clickableAncestor(AccessibilityNodeInfo node) {
        AccessibilityNodeInfo current = AccessibilityNodeInfo.obtain(node);
        for (int depth = 0; depth < 6 && current != null; depth++) {
            if (current.isClickable() && current.isEnabled()) return current;
            AccessibilityNodeInfo parent = current.getParent();
            current.recycle();
            current = parent;
        }
        if (current != null) current.recycle();
        return null;
    }

    private static AccessibilityNodeInfo firstScrollable(AccessibilityNodeInfo node, int depth) {
        if (node == null || depth > SNAPSHOT_MAX_DEPTH) return null;
        if (node.isScrollable() && node.isEnabled()) return AccessibilityNodeInfo.obtain(node);
        int children = Math.min(node.getChildCount(), 60);
        for (int i = 0; i < children; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            AccessibilityNodeInfo found = firstScrollable(child, depth + 1);
            child.recycle();
            if (found != null) return found;
        }
        return null;
    }

    private static String nodeLabel(AccessibilityNodeInfo node) {
        String text = safeText(node == null || node.isPassword() ? "" : node.getText());
        if (!text.isEmpty()) return text;
        return safeText(node == null ? "" : node.getContentDescription());
    }

    private static void recycleAll(List<AccessibilityNodeInfo> nodes) {
        for (AccessibilityNodeInfo node : nodes) {
            try { node.recycle(); } catch (Exception ignored) {}
        }
        nodes.clear();
    }

    private static String safeText(Object value) {
        String text = String.valueOf(value == null ? "" : value).replaceAll("\\s+", " ").trim();
        return text.length() > 160 ? text.substring(0, 160) : text;
    }

    private static String clean(String value) {
        return Normalizer.normalize(String.valueOf(value == null ? "" : value), Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9@._+ -]+", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static boolean isSensitiveControl(String value) {
        String v = clean(value);
        return v.matches(".*\\b(enviar|send|pagar|pay|comprar|buy|confirmar|confirm|excluir|delete|apagar|remover|remove|desinstalar|uninstall|publicar|post|transferir|transfer|finalizar compra|checkout)\\b.*");
    }
}
