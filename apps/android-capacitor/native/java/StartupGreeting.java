package com.sexta.assistant;

import android.app.Activity;
import android.speech.tts.TextToSpeech;

import java.util.Calendar;
import java.util.Locale;

/**
 * Small native greeting used when the Android app enters the foreground.
 * It intentionally does not open a Gemini Live session just to say hello.
 */
public final class StartupGreeting {
    private static final long MIN_GREETING_INTERVAL_MS = 20_000L;
    private static TextToSpeech tts;
    private static boolean ready = false;
    private static boolean pendingGreeting = false;
    private static long lastGreetingAt = 0L;

    private StartupGreeting() {}

    public static synchronized void onAppOpened(Activity activity) {
        if (activity == null) return;
        long now = System.currentTimeMillis();
        if (now - lastGreetingAt < MIN_GREETING_INTERVAL_MS) return;
        pendingGreeting = true;

        if (tts == null) {
            tts = new TextToSpeech(activity.getApplicationContext(), status -> {
                synchronized (StartupGreeting.class) {
                    ready = status == TextToSpeech.SUCCESS;
                    if (ready && tts != null) {
                        int language = tts.setLanguage(new Locale("pt", "BR"));
                        ready = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED;
                        tts.setSpeechRate(0.96f);
                        tts.setPitch(1.0f);
                    }
                    if (ready && pendingGreeting) speakNow();
                }
            });
            return;
        }

        if (ready) speakNow();
    }

    static String greetingForHour(int hour) {
        if (hour >= 5 && hour < 12) return "Bom dia, chefe.";
        if (hour >= 12 && hour < 18) return "Boa tarde, chefe.";
        return "Boa noite, chefe.";
    }

    private static synchronized void speakNow() {
        if (!ready || tts == null || !pendingGreeting) return;
        pendingGreeting = false;
        lastGreetingAt = System.currentTimeMillis();
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        tts.speak(greetingForHour(hour), TextToSpeech.QUEUE_FLUSH, null, "sexta-startup-greeting");
    }

    public static synchronized void shutdown() {
        pendingGreeting = false;
        ready = false;
        if (tts != null) {
            try { tts.stop(); } catch (Exception ignored) {}
            try { tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
        }
    }
}
