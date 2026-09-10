import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isSafeDiscoveredApp, normalizeAppName, resolveConfiguredApp, selectInstalledApp } from '../agent/app-resolver.mjs';

assert.equal(normalizeAppName('Google  Chrôme'), 'google chrome');
const installed = [
  { name: 'Google Chrome', source: 'startapp', appId: 'Chrome.App' },
  { name: 'Zen Browser', source: 'startapp', appId: 'Zen.App' },
  { name: 'Visual Studio Code', source: 'shortcut', target: 'C:\\Apps\\Code.exe' },
  { name: 'Notepad', source: 'apppath', target: 'C:\\Windows\\System32\\notepad.exe' },
  { name: 'Windows PowerShell', source: 'startapp', appId: 'Microsoft.PowerShell' },
  { name: 'Windows Terminal', source: 'startapp', appId: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe!App' }
];
assert.equal(selectInstalledApp('chrome', installed)?.name, 'Google Chrome');
assert.equal(selectInstalledApp('Google Chrome', installed)?.name, 'Google Chrome');
assert.equal(selectInstalledApp('zen', installed)?.name, 'Zen Browser');
assert.equal(selectInstalledApp('VS Code', installed)?.name, 'Visual Studio Code');
assert.equal(selectInstalledApp('notepad', installed)?.name, 'Notepad');
assert.equal(selectInstalledApp('PowerShell', installed), null);
assert.equal(selectInstalledApp('Windows Terminal', installed), null);
assert.equal(selectInstalledApp('aplicativo inexistente', installed), null);
assert.equal(isSafeDiscoveredApp({ name: 'Notepad', source: 'apppath', target: 'C:\\Windows\\System32\\notepad.exe' }), true);
assert.equal(isSafeDiscoveredApp({ name: 'Prompt de Comando', source: 'startapp', appId: 'cmd.exe' }), false);
assert.equal(isSafeDiscoveredApp({ name: 'PowerShell', source: 'shortcut', target: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }), false);
const configured = resolveConfiguredApp({ chrome: { command: 'chrome.exe' } }, 'Google Chrome');
assert.equal(configured?.key, 'chrome');

const source = fs.readFileSync(new URL('../agent/app-resolver.mjs', import.meta.url), 'utf8');
assert.match(source, /Get-StartApps/);
assert.match(source, /shell:AppsFolder/);
assert.match(source, /App Paths/);
assert.match(source, /focusExisting/);
assert.match(source, /focusWindowNative/);
assert.match(source, /APP_LAUNCH_NOT_VERIFIED/);
assert.match(source, /BLOCKED_DYNAMIC_APP/);
assert.match(source, /cmd\.exe/);
assert.match(source, /powershell\.exe/);
assert.doesNotMatch(source, /shell:\s*true/);
console.log('app resolver contracts ok');
