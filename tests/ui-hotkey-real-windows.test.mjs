import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { uiHotkey } from '../agent/windows-ui.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function ps(script, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch {}; reject(new Error('PS_TIMEOUT')); }, timeout);
    child.stdout.on('data', d => { out += d.toString('utf8'); });
    child.stderr.on('data', d => { err += d.toString('utf8'); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out.trim()) : reject(new Error(err.trim() || out.trim() || `powershell ${code}`)); });
    child.stdin.end(script, 'utf8');
  });
}

function startFixture(title, text) {
  const title64 = Buffer.from(title, 'utf8').toString('base64');
  const text64 = Buffer.from(text, 'utf8').toString('base64');
  const script = `
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
$title=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${title64}'))
$text=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${text64}'))
$w=New-Object System.Windows.Window
$w.Title=$title;$w.Width=520;$w.Height=220;$w.WindowStartupLocation='CenterScreen'
$box=New-Object System.Windows.Controls.TextBox
$box.Text=$text;$box.Margin='24';$box.FontSize=20
$w.Content=$box
$w.Add_ContentRendered({$box.Focus()|Out-Null;$box.CaretIndex=$box.Text.Length})
[void]$w.ShowDialog()
`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', '-'], { windowsHide: false, stdio: ['pipe', 'ignore', 'pipe'] });
  child.stdin.end(script, 'utf8');
  return child;
}

test('ui_hotkey reaches the real foreground app via SendInput', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const title = `SEXTA Hotkey ${Date.now()}`;
  const probe = `HOTKEY_PROBE_${Date.now()}`;
  const fixture = startFixture(title, probe);
  t.after(() => { try { fixture.kill(); } catch {} });

  let activated = false;
  for (let i = 0; i < 30 && !activated; i += 1) {
    const result = await ps(`$ws=New-Object -ComObject WScript.Shell;if($ws.AppActivate('${title.replace(/'/g, "''")}')){'yes'}else{'no'}`).catch(() => 'no');
    activated = result.includes('yes');
    if (!activated) await sleep(150);
  }
  assert.equal(activated, true, 'fixture window did not become foreground');
  await sleep(250);

  const selectAll = await uiHotkey('ctrl+a');
  assert.equal(selectAll.sent, true);
  assert.equal(selectAll.via, 'SendInput');
  const copy = await uiHotkey('ctrl+c');
  assert.equal(copy.sent, true);
  assert.equal(copy.via, 'SendInput');
  await sleep(150);

  const clipboard = await ps('Get-Clipboard -Raw');
  assert.equal(clipboard, probe);
  await assert.rejects(() => uiHotkey('ctrl+alt+delete'), /PC_UI_HOTKEY_NOT_ALLOWED/);
});
