# Voice Core v10 — P0 patch plan

Target: `apps/android-capacitor/native/java/SextaForegroundService.java`

Changes:
- send wake-tail text through `realtimeInput.text` on Gemini 3.1 instead of post-setup `clientContent`;
- do not arm response timeout from the first partial input transcription;
- decouple blocking PCM output from the WebSocket event callback;
- keep `assistantSpeaking` true until queued output is drained or interrupted;
- invalidate queued audio immediately on interruption/reconnect/stop;
- report clientVersion v10 consistently.

This file exists as an implementation checklist and regression reference.
