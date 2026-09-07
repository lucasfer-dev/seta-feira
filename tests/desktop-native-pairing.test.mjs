import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Desktop 2.1.1 faz pairing nativo sem PowerShell', () => {
  const pkg = JSON.parse(read('apps/desktop-electron/package.json'));
  const main = read('apps/desktop-electron/main.cjs');
  const preload = read('apps/desktop-electron/preload.cjs');
  const web = read('public/desktop-pairing-auth-fix.js');

  assert.equal(pkg.version, '2.1.1');
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
  assert.doesNotMatch(preload, /lastLog/);
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
});
