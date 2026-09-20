import { events } from '../v2/event-bus.mjs';
import { setComponentStatus } from '../v2/observability.mjs';
import { updateAudioState } from '../v2/world-state.mjs';
import { sextaError } from '../v2/errors.mjs';

export class AudioService {
  constructor(provider = null) {
    this.provider = provider;
    this.started = false;
    this.inputDevice = null;
    this.outputDevice = null;
    this.lastLevel = 0;
    this.lastSpeechAt = null;
  }

  setProvider(provider) {
    if (this.started) throw sextaError('AUDIO_PROVIDER_LOCKED', 'Não é possível trocar o provider enquanto o áudio está ativo.');
    this.provider = provider;
  }

  async start(options = {}) {
    if (this.started) return this.status();
    if (!this.provider?.start) {
      throw sextaError('AUDIO_DEVICE_NOT_FOUND', 'Audio provider não configurado.', { recoverable: true });
    }

    try {
      const detail = await this.provider.start({
        ...options,
        onLevel: level => this.reportLevel(level),
        onSpeech: active => this.reportSpeech(active),
        onDevice: device => this.reportDevice(device),
        onError: error => this.reportError(error)
      });

      this.started = true;
      this.inputDevice = detail?.inputDevice || this.inputDevice;
      this.outputDevice = detail?.outputDevice || this.outputDevice;
      updateAudioState({
        inputDevice: this.inputDevice,
        outputDevice: this.outputDevice
      });
      setComponentStatus('Audio', 'ONLINE', this.status());
      events.emitEvent('voice.audio.started', this.status());
      return this.status();
    } catch (error) {
      setComponentStatus('Audio', 'FAILED', { reason: error?.code || 'AUDIO_START_FAILED', message: error?.message || String(error) });
      throw error;
    }
  }

  async stop() {
    if (!this.started) return this.status();
    await this.provider?.stop?.();
    this.started = false;
    updateAudioState({ inputLevel: 0, speechDetected: false });
    setComponentStatus('Audio', 'OFFLINE', this.status());
    events.emitEvent('voice.audio.stopped', this.status());
    return this.status();
  }

  reportLevel(level) {
    const normalized = Math.max(0, Math.min(1, Number(level) || 0));
    this.lastLevel = normalized;
    updateAudioState({ inputLevel: normalized });
    events.emitEvent('voice.audio.level', { level: normalized });
  }

  reportSpeech(active) {
    const value = Boolean(active);
    if (value) this.lastSpeechAt = new Date().toISOString();
    updateAudioState({ speechDetected: value });
    events.emitEvent(value ? 'voice.speech.started' : 'voice.speech.ended', { at: new Date().toISOString() });
  }

  reportDevice(device = {}) {
    if (device.inputDevice !== undefined) this.inputDevice = device.inputDevice;
    if (device.outputDevice !== undefined) this.outputDevice = device.outputDevice;
    updateAudioState({ inputDevice: this.inputDevice, outputDevice: this.outputDevice });
    events.emitEvent('voice.audio.device.changed', {
      inputDevice: this.inputDevice,
      outputDevice: this.outputDevice
    });
  }

  reportError(error) {
    const message = error?.message || String(error || 'AUDIO_ERROR');
    setComponentStatus('Audio', 'FAILED', { reason: error?.code || 'AUDIO_RUNTIME_FAILED', message });
    events.emitEvent('voice.audio.error', { code: error?.code || 'AUDIO_RUNTIME_FAILED', message });
  }

  status() {
    return {
      online: this.started,
      inputDevice: this.inputDevice,
      outputDevice: this.outputDevice,
      inputLevel: this.lastLevel,
      lastSpeechAt: this.lastSpeechAt
    };
  }
}

export const audioService = new AudioService();
