import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeAppName, resolveConfiguredApp, selectInstalledApp } from '../agent/app-resolver.mjs';

assert.equal(normalizeAppName('Google  Chrôme'), 'google chrome');
const installed = [
  { name: 'Google Chrome', source: 'startapp', appId: 'Chrome.App' },
  { name: 'Zen Browser', source: 'startapp', appId: 'Zen.App' },
  { name: 'Visual Studio Code', source: 'shortcut', target: 'C:\\Apps\\Code.exe' }
];
assert.equal(selectInstalledApp('chrome', installed)?.name, 'Google Chrome');
assert.equal(selectInstalledApp('Google Chrome', installed)?.name, 'Google Chrome');
assert.equal(selectInstalledApp('zen', installed)?.name, 'Zen Browser');
assert.equal(selectInstalledApp('VS Code', installed)?.name, 'Visual Studio Code');
assert.equal(selectInstalledApp('aplicativo inexistente', installed), null);
const configured = resolveConfiguredApp({ chrome: { command: 'chrome.exe' } }, 'Google Chrome');
assert.equal(configured?.key, 'chrome');

const source = fs.readFileSync(new URL('../agent/app-resolver.mjs', import.meta.url), 'utf8');
assert.match(source, /Get-StartApps/);
assert.match(source, /shell:AppsFolder/);
assert.match(source, /cmd\.exe/);
assert.match(source, /powershell\.exe/);
assert.doesNotMatch(source, /shell:\s*true/);
console.log('app resolver contracts ok');
