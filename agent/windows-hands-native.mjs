import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pending = new Map();
let child = null;
let starting = null;
let buffer = '';
let sequence = 0;

function candidates() {
  return [
    process.env.SEXTA_HANDS_EXE,
    path.join(here, 'native', 'SextaHands.exe'),
    path.resolve(here, '../native/windows-hands/bin/SextaHands.exe'),
    path.resolve(here, '../native/windows-hands/bin/Release/net48/SextaHands.exe')
  ].filter(Boolean);
}

export function nativeHandsExecutable() {
  return candidates().find(file => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  }) || '';
}

export function nativeHandsAvailable() {
  return process.platform === 'win32' && Boolean(nativeHandsExecutable());
}

function rejectAll(error) {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(error);
  }
  pending.clear();
}

function dispose(error = null) {
  const current = child;
  child = null;
  buffer = '';
  try { current?.kill(); } catch {}
  if (error) rejectAll(error);
}

function onStdout(chunk) {
  buffer += chunk.toString('utf8');
  while (true) {
    const index = buffer.indexOf('\n');
    if (index < 0) return;
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;

    let message;
    try { message = JSON.parse(line); } catch { continue; }
    const id = String(message?.id || '');
    const request = pending.get(id);
    if (!request) continue;
    pending.delete(id);
    clearTimeout(request.timer);

    if (message.ok === true) {
      request.resolve({
        ...(message.result && typeof message.result === 'object' ? message.result : { result: message.result }),
        nativeDurationMs: Number(message.durationMs) || 0,
        nativeBackend: 'sexta-hands-v3'
      });
      continue;
    }

    const error = new Error(String(message.error || 'PC_HANDS_NATIVE_ERROR'));
    error.code = String(message.error || 'PC_HANDS_NATIVE_ERROR').split(':')[0];
    error.nativeDurationMs = Number(message.durationMs) || 0;
    request.reject(error);
  }
}

async function start() {
  if (process.platform !== 'win32') throw new Error('PC_WINDOWS_ONLY');
  if (child && !child.killed && child.stdin?.writable) return child;
  if (starting) return starting;

  starting = new Promise((resolve, reject) => {
    const exe = nativeHandsExecutable();
    if (!exe) {
      reject(new Error('PC_HANDS_NATIVE_UNAVAILABLE'));
      return;
    }

    const proc = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = proc;
    let settled = false;
    const bootTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      dispose();
      reject(new Error('PC_HANDS_NATIVE_START_TIMEOUT'));
    }, 2500);

    proc.stdout.on('data', onStdout);
    proc.stderr.on('data', chunk => {
      const text = chunk.toString('utf8').trim();
      if (text) process.stderr.write(`[SEXTA Hands] ${text.slice(0, 1200)}\n`);
    });
    proc.on('error', raw => {
      const error = new Error(`PC_HANDS_NATIVE_START_FAILED:${String(raw?.message || raw).slice(0, 240)}`);
      if (!settled) {
        settled = true;
        clearTimeout(bootTimer);
        reject(error);
      }
      if (child === proc) dispose(error);
    });
    proc.on('exit', (code, signal) => {
      const error = new Error(`PC_HANDS_NATIVE_EXITED:${code ?? 'null'}:${signal || ''}`);
      if (!settled) {
        settled = true;
        clearTimeout(bootTimer);
        reject(error);
      }
      if (child === proc) dispose(error);
    });

    const id = `boot-${process.pid}-${Date.now()}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      if (settled) return;
      settled = true;
      clearTimeout(bootTimer);
      dispose();
      reject(new Error('PC_HANDS_NATIVE_PING_TIMEOUT'));
    }, 1800);

    pending.set(id, {
      timer,
      resolve: () => {
        if (settled) return;
        settled = true;
        clearTimeout(bootTimer);
        resolve(proc);
      },
      reject: error => {
        if (settled) return;
        settled = true;
        clearTimeout(bootTimer);
        dispose();
        reject(error);
      }
    });

    proc.stdin.write(`${JSON.stringify({ id, action: 'ping', payload: {} })}\n`, 'utf8', error => {
      if (!error || settled) return;
      const request = pending.get(id);
      if (request) {
        pending.delete(id);
        clearTimeout(request.timer);
      }
      settled = true;
      clearTimeout(bootTimer);
      dispose();
      reject(new Error(`PC_HANDS_NATIVE_PIPE_FAILED:${String(error?.message || error).slice(0, 240)}`));
    });
  }).finally(() => { starting = null; });

  return starting;
}

export async function nativeHandsRequest(action, payload = {}, { timeoutMs = 6000 } = {}) {
  const proc = await start();
  if (!proc?.stdin?.writable) throw new Error('PC_HANDS_NATIVE_UNAVAILABLE');
  const id = `${process.pid}-${Date.now()}-${++sequence}`;
  const timeout = Math.max(500, Math.min(25000, Number(timeoutMs) || 6000));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PC_HANDS_NATIVE_TIMEOUT:${String(action || '').slice(0, 80)}`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    const body = JSON.stringify({ id, action: String(action || '').slice(0, 80), payload: payload && typeof payload === 'object' ? payload : {} });
    proc.stdin.write(`${body}\n`, 'utf8', error => {
      if (!error) return;
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      clearTimeout(request.timer);
      reject(new Error(`PC_HANDS_NATIVE_PIPE_FAILED:${String(error?.message || error).slice(0, 240)}`));
    });
  });
}

export function isNativeHandsUnavailable(error) {
  return /^PC_(?:WINDOWS_ONLY|HANDS_NATIVE_(?:UNAVAILABLE|START_FAILED|START_TIMEOUT|PING_TIMEOUT|EXITED|PIPE_FAILED))/.test(String(error?.message || error || ''));
}

export function stopNativeHands() {
  dispose();
}
