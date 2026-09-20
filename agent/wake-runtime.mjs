import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ps1 = path.join(here, 'wake-word.ps1');
const allowFallback = String(process.env.SEXTA_WAKE_ALLOW_SYSTEM_SPEECH_FALLBACK || 'true').toLowerCase() !== 'false';

function emit(type, ...parts) {
  process.stdout.write([type, ...parts].join('\t') + '\n');
}

async function tryNativeEngine() {
  const modulePath = process.env.SEXTA_WAKE_NATIVE_MODULE || '';
  if (!modulePath) return { started: false, reason: 'WAKE_NATIVE_ENGINE_NOT_CONFIGURED' };
  try {
    const mod = await import(modulePath);
    if (typeof mod.startWakeEngine !== 'function') return { started: false, reason: 'WAKE_NATIVE_ENGINE_INVALID' };
    await mod.startWakeEngine({
      phrase: 'sexta-feira',
      onReady: detail => emit('READY', 'native', detail?.model || 'sexta-feira'),
      onAudio: state => emit('AUDIO', state || 'Listening'),
      onHeard: detail => emit('HEARD', detail?.text || '', detail?.confidence ?? ''),
      onWake: detail => emit('WAKE', detail?.phrase || 'sexta-feira', detail?.confidence ?? 1, detail?.command || ''),
      onError: error => emit('ERROR', error?.code || 'WAKE_ENGINE_ERROR', error?.message || String(error))
    });
    return { started: true };
  } catch (error) {
    return { started: false, reason: 'WAKE_NATIVE_ENGINE_LOAD_FAILED', error };
  }
}

function startSystemSpeechFallback() {
  if (process.platform !== 'win32') throw new Error('WAKE_FALLBACK_WINDOWS_REQUIRED');
  if (!existsSync(ps1)) throw new Error('WAKE_FALLBACK_SCRIPT_MISSING');

  const child = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', ps1, '-MinConfidence', process.env.SEXTA_WAKE_MIN_CONFIDENCE || '0.22'
  ], { windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });

  child.on('exit', code => process.exit(code ?? 1));
  child.on('error', error => {
    emit('ERROR', 'WAKE_ENGINE_CRASHED', error.message || String(error));
    process.exit(5);
  });
}

const native = await tryNativeEngine();
if (!native.started) {
  emit('INFO', native.reason || 'WAKE_NATIVE_ENGINE_UNAVAILABLE');
  if (!allowFallback) {
    emit('ERROR', 'WAKE_MODEL_LOAD_FAILED', native.error?.message || native.reason || 'Native wake engine unavailable');
    process.exit(4);
  }
  startSystemSpeechFallback();
}
