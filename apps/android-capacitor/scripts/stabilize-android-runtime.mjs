import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const servicePath = path.join(appRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'sexta', 'assistant', 'SextaForegroundService.java');
const loopPath = path.join(appRoot, 'android', 'app', 'src', 'main', 'java', 'com', 'sexta', 'assistant', 'AndroidCommandLoop.java');

if (fs.existsSync(loopPath)) {
  let loop = fs.readFileSync(loopPath, 'utf8');
  loop = loop.replace(/\n\s*executeNewestSyncedVoiceCommand\(context\);/g, '');
  loop = loop.replace(
    'scheduler.scheduleWithFixedDelay(() -> tick(context), 1, 3, TimeUnit.SECONDS);',
    'scheduler.scheduleWithFixedDelay(() -> tick(context), 2, 6, TimeUnit.SECONDS);'
  );
  loop = loop.replace('.put("kind", "android")', '.put("kind", "phone")');
  loop = loop.replace(
    '.put("manufacturer", Build.MANUFACTURER)',
    '.put("nativeAndroid", true)\n                        .put("platform", "android")\n                        .put("manufacturer", Build.MANUFACTURER)'
  );
  fs.writeFileSync(loopPath, loop);
}

if (fs.existsSync(servicePath)) {
  let service = fs.readFileSync(servicePath, 'utf8');

  // Legacy builds used VOICE_RECOGNITION directly. Only upgrade that old path.
  // Full-duplex builds own their source selection in createLiveAudioRecord():
  // VOICE_COMMUNICATION first, VOICE_RECOGNITION as a real fallback. Rewriting
  // every VOICE_RECOGNITION occurrence would silently destroy that fallback.
  if (!service.includes('createLiveAudioRecord(')) {
    service = service.replace(
      'new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, INPUT_RATE,',
      'new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, INPUT_RATE,'
    );
  }

  fs.writeFileSync(servicePath, service);
}

console.log('SEXTA runtime estabilizado: sem sync polling duplicado, fila reduzida e fonte de áudio full-duplex preservada.');
