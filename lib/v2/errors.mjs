export class SextaError extends Error {
  constructor(code, message, options = {}) {
    super(message || code, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SextaError';
    this.code = String(code || 'UNKNOWN_ERROR');
    this.recoverable = options.recoverable ?? false;
    this.retryable = options.retryable ?? false;
    this.details = options.details && typeof options.details === 'object' ? options.details : {};
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      recoverable: this.recoverable,
      retryable: this.retryable,
      details: this.details
    };
  }
}

export function sextaError(code, message, options = {}) {
  return new SextaError(code, message, options);
}

export function normalizeError(error, fallbackCode = 'UNKNOWN_ERROR') {
  if (error instanceof SextaError) return error;
  return new SextaError(
    error?.code || fallbackCode,
    error?.message || String(error || fallbackCode),
    { cause: error, recoverable: false, retryable: false }
  );
}

export const ERROR_CODES = Object.freeze({
  AUDIO_DEVICE_NOT_FOUND: 'AUDIO_DEVICE_NOT_FOUND',
  WAKE_MODEL_LOAD_FAILED: 'WAKE_MODEL_LOAD_FAILED',
  WAKE_ENGINE_CRASHED: 'WAKE_ENGINE_CRASHED',
  REALTIME_CONNECTION_FAILED: 'REALTIME_CONNECTION_FAILED',
  APP_NOT_FOUND: 'APP_NOT_FOUND',
  WINDOW_NOT_FOUND: 'WINDOW_NOT_FOUND',
  ACTION_NOT_VERIFIED: 'ACTION_NOT_VERIFIED',
  DEVICE_OFFLINE: 'DEVICE_OFFLINE',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  GOOGLE_TOKEN_EXPIRED: 'GOOGLE_TOKEN_EXPIRED',
  MISSION_FAILED: 'MISSION_FAILED'
});
