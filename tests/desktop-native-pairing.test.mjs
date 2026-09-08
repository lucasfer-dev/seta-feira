import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Desktop moderno faz pairing nativo sem PowerShell de setup', () => {
  const pkg = JSON.parse(read('apps/desktop-electron/package.json'));
  const main = read('apps/desktop-electron/main.cjs');
  const preload = read('apps/desktop-electron/preload.cjs');
  const web = read('public/desktop-pairing-auth-fix.js');
  const version = String(pkg.version || '').split('.').map(Number);
  assert.equal(version.length, 3);
  assert.ok(version.every(Number.isFinite));
  assert.ok(version[0] > 2 || (version[0] === 2 && (version[1] > 1 || (version[1] === 1 && version[2] >= 3))), `Desktop ${pkg.version} é anterior ao pairing nativo seguro`);
  assert.equal(pkg.main, 'secure-main.cjs');
  assert.match(main, /system:pair-agent/);
  assert.match(main, /pairAgent\(payload/);
  assert.match(main, /SEXTA_AGENT_STATE/);
  assert.match(main, /SEXTA_AGENT_AUDIT/);
  assert.match(main, /stdio: \['ignore', 'pipe', 'pipe'\]/);
  assert.doesNotMatch(main, /spawn\('powershell\.exe'.*setup/i);
  assert.match(preload, /pairAgent/);
  assert.match(web, /system\.pairAgent/);
  assert.match(web, /PAREAR ESTE PC/);
  assert.doesNotThrow(() => new Function(web));
});

test('Desktop trava navegacao externa antes de carregar bridge nativa', () => {
  const secure = read('apps/desktop-electron/secure-main.cjs');
  assert.match(secure, /TRUSTED_ORIGIN/);
  assert.match(secure, /will-navigate/);
  assert.match(secure, /will-redirect/);
  assert.match(secure, /setPermissionRequestHandler/);
  assert.match(secure, /\['media', 'notifications'\]/);
});

test('Desktop continua sem primitive shell/exec exposta ao renderer', () => {
  const preload = read('apps/desktop-electron/preload.cjs');
  assert.doesNotMatch(preload, /shell|exec|spawn|powershell/i);
  assert.match(preload, /const \{ lastLog, \.\.\.safeDiagnostics \}/);
  assert.match(preload, /status\.agent\.diagnostics = safeDiagnostics/);
});

test('Windows Hands nao usa PowerShell Bypass ou EncodedCommand', () => {
  const windowsUi = read('agent/windows-ui.mjs');
  assert.doesNotMatch(windowsUi, /ExecutionPolicy[^\n]*Bypass/i);
  assert.doesNotMatch(windowsUi, /EncodedCommand/i);
  assert.match(windowsUi, /'-Command', '-'/);
});

test('visao possui fallback, cooldown e cache anti-overload', () => {
  const vision = read('api/pc-vision-analyze.js');
  assert.match(vision, /GEMINI_VISION_FALLBACK_MODELS/);
  assert.match(vision, /cooldowns/);
  assert.match(vision, /CACHE_TTL_MS/);
  assert.match(vision, /vision_temporarily_unavailable/);
  assert.match(vision, /cacheHit/);
});

test('visao recupera erro 400 do provider em modo compativel', () => {
  const vision = read('api/pc-vision-analyze.js');
  assert.match(vision, /compatibilityFailure/);
  assert.match(vision, /compatibilityMode/);
  assert.match(vision, /mode: compatibilityMode \? 'compat' : 'json'/);
  assert.match(vision, /responseMimeType: 'application\/json'/);
  assert.doesNotMatch(vision, /thinkingConfig/);
});

test('sync tolera falhas parciais de backend', () => {
  const sync = read('api/sync.js');
  assert.match(sync, /Promise\.allSettled/);
  assert.match(sync, /degraded/);
  assert.match(sync, /STALE/);
});

test('identidade de produto nao regride para 1.x', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  const product = read('public/product-normalize.js');
  const serviceWorker = read('public/service-worker.js');
  assert.equal(manifest.name, 'SEXTA');
  assert.match(product, /4\.1\.1/);
  assert.match(serviceWorker, /sexta-4\.1\.1-operational/);
  assert.doesNotThrow(() => new Function(product));
});

test('Voice Core dá janela maior apenas para análise de tela', () => {
  const voice = read('public/voice-core-v10.js');
  assert.match(voice, /const TOOL_TIMEOUT_MS = 12000;/);
  assert.match(voice, /const SCREEN_TOOL_TIMEOUT_MS = 22000;/);
  assert.match(voice, /pc_screen_analyze[^\n]*SCREEN_TOOL_TIMEOUT_MS[^\n]*TOOL_TIMEOUT_MS/);
});
