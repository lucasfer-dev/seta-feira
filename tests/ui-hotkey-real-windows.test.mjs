import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { focusWindowNative } from '../agent/windows-control-v2.mjs';
import { uiHotkey, windowList } from '../agent/windows-ui.mjs';

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
    child.stdin.end(`${script}\r\n`, 'utf8');
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
  child.stdin.end(`${script}\r\n`, 'utf8');
  return child;
}

async function findFixture(title, timeoutMs = 7000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const windows = (await windowList(30)).windows || [];
      const found = windows.find(win => win.title === title || String(win.title || '').includes(title));
      if (found) return found;
    } catch {}
    await sleep(140);
  }
  return null;
}

test('ui_hotkey reaches the real foreground app via SendInput and resolves natural browser intent', { skip: process.platform !== 'win32', timeout: 35000 }, async t => {
  const title = `SEXTA Hotkey ${Date.now()}`;
  const probe = `HOTKEY_PROBE_${Date.now()}`;
  const fixture = startFixture(title, probe);
  t.after(() => { try { fixture.kill(); } catch {} });

  const win = await findFixture(title);
  if (!win && process.env.GITHUB_ACTIONS === 'true') {
    t.skip('GitHub hosted Windows runner não expôs desktop interativo para a fixture; validar entrega foreground no PC local.');
    return;
  }
  assert.ok(win, 'fixture window not discoverable');

  let focus;
  try {
    focus = await focusWindowNative(title, win.hwnd);
  } catch (error) {
    if (process.env.GITHUB_ACTIONS === 'true' && /PC_WINDOW_FOCUS_NOT_VERIFIED|PC_WINDOW_NO_FOREGROUND/.test(String(error?.message || error))) {
      t.skip(`GitHub hosted Windows runner bloqueou foreground interativo: ${error.message}`);
      return;
    }
    throw error;
  }
  assert.equal(focus.verified, true);
  await sleep(180);

  const selectAll = await uiHotkey('ctrl+a');
  assert.equal(selectAll.sent, true);
  assert.equal(selectAll.via, 'SendInput');
  const copy = await uiHotkey('ctrl+c');
  assert.equal(copy.sent, true);
  assert.equal(copy.via, 'SendInput');
  await sleep(120);

  const clipboard = await ps('Get-Clipboard -Raw');
  assert.equal(clipboard, probe);

  // A frase natural que o usuário realmente fala deve chegar ao helper nativo e
  // ser resolvida pelo próprio backend, sem depender de prompt perfeito no Live.
  const newTab = await uiHotkey('nova aba');
  assert.equal(newTab.sent, true);
  assert.equal(newTab.via, 'SendInput');
  assert.equal(newTab.shortcut, 'ctrl+t');

  await assert.rejects(() => uiHotkey('ctrl+alt+delete'), /PC_UI_HOTKEY_NOT_ALLOWED/);
});
