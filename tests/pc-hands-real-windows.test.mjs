import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { browserBack, browserClick, browserForward, browserOpen, browserReload, browserSelectTab, browserSnapshot, browserTabs, browserType } from '../agent/browser-agent.mjs';
import { activeWindow, uiClickText, uiTree, uiTypeText, windowList } from '../agent/windows-ui.mjs';
import { closeWindowNative, focusWindowNative, listWindows, moveResizeWindow, setWindowState } from '../agent/windows-control-v2.mjs';
import { uiAction } from '../agent/windows-ui-actions.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(fn, { timeout = 15000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  if (lastError) throw lastError;
  throw new Error('WAIT_TIMEOUT');
}

async function browserActOnFreshElement(cfg, findElement, action, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await browserSnapshot(cfg);
    const element = findElement(snapshot);
    assert.ok(element, `Elemento semântico não encontrado em ${snapshot.url || 'página desconhecida'}`);
    try {
      return { snapshot, element, result: await action(element, snapshot) };
    } catch (error) {
      lastError = error;
      if (!/PC_BROWSER_STALE_SNAPSHOT|PC_BROWSER_STATE_UNAVAILABLE|PC_BROWSER_TARGET_GONE/.test(String(error?.message || error))) throw error;
      await sleep(180);
    }
  }
  throw lastError || new Error('PC_BROWSER_SEMANTIC_RETRY_EXHAUSTED');
}

function startUiFixture(title, state = 'Minimized') {
  const safeState = ['Minimized', 'Maximized', 'Normal'].includes(state) ? state : 'Normal';
  const title64 = Buffer.from(title, 'utf8').toString('base64');
  const config64 = Buffer.from('Configurações', 'utf8').toString('base64');
  const script = `
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
$titleText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${title64}'))
$configText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config64}'))
$window=New-Object System.Windows.Window
$window.Title=$titleText;$window.Width=500;$window.Height=320;$window.WindowStartupLocation='CenterScreen'
$panel=New-Object System.Windows.Controls.StackPanel;$panel.Margin='24'
$nameLabel=New-Object System.Windows.Controls.TextBlock;$nameLabel.Text='Nome';$nameLabel.Margin='0,0,0,4'
$name=New-Object System.Windows.Controls.TextBox;$name.Width=280;$name.HorizontalAlignment='Left';$name.Margin='0,0,0,12'
[System.Windows.Automation.AutomationProperties]::SetName($name,'Nome')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($name,'NameInput')
$echo=New-Object System.Windows.Controls.TextBlock;$echo.Text='typed:';$echo.Margin='0,0,0,12';$name.Add_TextChanged({$echo.Text='typed:'+$name.Text})
$passLabel=New-Object System.Windows.Controls.TextBlock;$passLabel.Text='Senha';$passLabel.Margin='0,0,0,4'
$pass=New-Object System.Windows.Controls.PasswordBox;$pass.Width=280;$pass.HorizontalAlignment='Left';$pass.Margin='0,0,0,18'
[System.Windows.Automation.AutomationProperties]::SetName($pass,'Senha')
[System.Windows.Automation.AutomationProperties]::SetAutomationId($pass,'PasswordInput')
$button=New-Object System.Windows.Controls.Button;$button.Content=$configText;$button.Width=180;$button.HorizontalAlignment='Left'
[System.Windows.Automation.AutomationProperties]::SetName($button,$configText)
[System.Windows.Automation.AutomationProperties]::SetAutomationId($button,'SettingsButton')
$button.Add_Click({$window.Title='Clicked '+$titleText})
[void]$panel.Children.Add($nameLabel);[void]$panel.Children.Add($name);[void]$panel.Children.Add($echo);[void]$panel.Children.Add($passLabel);[void]$panel.Children.Add($pass);[void]$panel.Children.Add($button)
$window.Content=$panel;$window.WindowState='${safeState}';$window.Add_ContentRendered({$name.Focus()|Out-Null});[void]$window.ShowDialog()
`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', '-'], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: false
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
  child.fixtureError = () => stderr.trim();
  child.stdin.end(script, 'utf8');
  return child;
}

async function waitForLegacyWindow(title, fixture) {
  let lastLegacy = [];
  let lastV2 = [];
  try {
    return await waitFor(async () => {
      if (fixture.exitCode !== null) throw new Error(`UI_FIXTURE_EXITED_${fixture.exitCode}:${fixture.fixtureError?.() || 'sem stderr'}`);
      const legacy = await windowList(30);
      lastLegacy = legacy.windows || [];
      const found = lastLegacy.find(win => win.title === title || String(win.title).includes(title));
      if (found) return found;
      try { lastV2 = (await listWindows(80)).windows || []; } catch {}
      return null;
    });
  } catch (error) {
    const diag = JSON.stringify({ fixtureExit: fixture.exitCode, fixtureError: fixture.fixtureError?.() || '', legacyTitles: lastLegacy.map(w => w.title), v2Titles: lastV2.map(w => w.title) });
    throw new Error(`${error.message}:${diag}`);
  }
}

async function assertV2SeesWindow(title, hwnd = 0) {
  const snapshot = await listWindows(80);
  const found = snapshot.windows.find(win => (hwnd && Number(win.hwnd) === Number(hwnd)) || win.title === title || String(win.title).includes(title));
  assert.ok(found, `PC_WINDOW_V2_MISSED:${JSON.stringify({ title, hwnd, count: snapshot.count, titles: snapshot.windows.map(w => w.title).slice(0, 40) })}`);
  return found;
}

test('Windows Hands restores/focuses and drives UI Automation sem senha', { skip: process.platform !== 'win32', timeout: 50000 }, async t => {
  const unique = `SEXTA Hands ${Date.now()}`;
  const fixture = startUiFixture(unique);
  t.after(() => { try { fixture.kill(); } catch {} });
  const legacy = await waitForLegacyWindow(unique, fixture);
  await assertV2SeesWindow(unique, legacy.hwnd);

  const focused = await focusWindowNative(unique, legacy.hwnd);
  assert.equal(focused.verified, true);
  assert.equal(focused.restored, true);
  assert.ok(String((await activeWindow()).title).includes(unique));

  const tree = await uiTree(180);
  const diagnostic = JSON.stringify({ window: tree.window, count: tree.count, enumerated: tree.enumerated, provider: tree.provider, nodes: (tree.nodes || []).slice(0, 60) });
  assert.ok(tree.nodes.some(node => node.name === 'Configurações'), diagnostic);
  assert.ok(tree.nodes.some(node => node.name === 'Nome'), diagnostic);
  assert.ok(tree.nodes.some(node => node.password === true || node.name === '[password]'), diagnostic);

  const clicked = await uiClickText('Configurações');
  assert.equal(clicked.clicked, true);
  await waitFor(async () => String((await activeWindow()).title).startsWith('Clicked '));

  const typed = await uiTypeText('Lucas', 'Nome');
  assert.equal(typed.typed, true);
  assert.equal(typed.verified, true);
  await waitFor(async () => (await uiTree(180)).nodes.some(node => node.name === 'typed:Lucas'));
  await assert.rejects(() => uiTypeText('segredo', '[password]'), /PC_UI_PASSWORD_FIELD_BLOCKED/);
});

test('Window Control v2 minimizes, restores, maximizes, moves and closes a real HWND', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const title = `SEXTA Window Control ${Date.now()}`;
  const fixture = startUiFixture(title, 'Normal');
  t.after(() => { try { fixture.kill(); } catch {} });
  const legacy = await waitForLegacyWindow(title, fixture);
  const initial = await assertV2SeesWindow(title, legacy.hwnd);
  assert.ok(initial.hwnd);

  const minimized = await setWindowState(title, 'minimize', initial.hwnd);
  assert.equal(minimized.verified, true);
  assert.equal(minimized.minimized, true);

  const restored = await focusWindowNative(title, initial.hwnd);
  assert.equal(restored.verified, true);
  assert.equal(restored.restored, true);
  assert.equal(Number(restored.afterHwnd), Number(initial.hwnd));

  const maximized = await setWindowState(title, 'maximize', initial.hwnd);
  assert.equal(maximized.verified, true);
  assert.equal(maximized.maximized, true);

  await setWindowState(title, 'restore', initial.hwnd);
  const moved = await moveResizeWindow(title, { hwnd: initial.hwnd, x: 120, y: 90, width: 640, height: 420 });
  assert.equal(moved.verified, true);
  assert.ok(Math.abs(moved.x - 120) <= 4);
  assert.ok(Math.abs(moved.y - 90) <= 4);
  assert.ok(Math.abs(moved.width - 640) <= 10);
  assert.ok(Math.abs(moved.height - 420) <= 10);

  const closed = await closeWindowNative(title, initial.hwnd);
  assert.equal(closed.verified, true);
  assert.equal(closed.closed, true);
  await waitFor(async () => !(await windowList(30)).windows.some(win => Number(win.hwnd) === Number(initial.hwnd)));
});

test('Generic UIA action targets AutomationId and blocks credentials', { skip: process.platform !== 'win32', timeout: 50000 }, async t => {
  const title = `SEXTA UI Action ${Date.now()}`;
  const fixture = startUiFixture(title, 'Normal');
  t.after(() => { try { fixture.kill(); } catch {} });
  const legacy = await waitForLegacyWindow(title, fixture);
  await focusWindowNative(title, legacy.hwnd);

  const set = await uiAction({ action: 'set_value', automationId: 'NameInput', controlType: 'Edit', value: 'Jarvis' });
  assert.equal(set.verified, true);
  await waitFor(async () => (await uiTree(180)).nodes.some(node => node.name === 'typed:Jarvis'));

  const invoked = await uiAction({ action: 'invoke', automationId: 'SettingsButton', controlType: 'Button' });
  assert.equal(invoked.ok, true);
  await waitFor(async () => String((await activeWindow()).title).startsWith('Clicked '));
  await assert.rejects(() => uiAction({ action: 'set_value', automationId: 'PasswordInput', value: 'segredo' }), /PC_UI_PASSWORD_FIELD_BLOCKED/);
});

test('Windows Hands focuses maximized windows and resolves exact title among similar windows', { skip: process.platform !== 'win32', timeout: 50000 }, async t => {
  const prefix = `SEXTA Similar ${Date.now()}`;
  const titleA = `${prefix} Alpha`;
  const titleB = `${prefix} Beta`;
  const fixtureA = startUiFixture(titleA, 'Maximized');
  const fixtureB = startUiFixture(titleB, 'Normal');
  t.after(() => { for (const child of [fixtureA, fixtureB]) { try { child.kill(); } catch {} } });
  const winA = await waitForLegacyWindow(titleA, fixtureA);
  const winB = await waitForLegacyWindow(titleB, fixtureB);
  await assertV2SeesWindow(titleA, winA.hwnd);
  await assertV2SeesWindow(titleB, winB.hwnd);

  const focusedA = await focusWindowNative(titleA, winA.hwnd);
  assert.equal(focusedA.verified, true);
  assert.equal(focusedA.title, titleA);
  assert.equal(focusedA.restored, false);
  assert.equal((await activeWindow()).title, titleA);

  const focusedB = await focusWindowNative(titleB, winB.hwnd);
  assert.equal(focusedB.verified, true);
  assert.equal(focusedB.title, titleB);
  assert.equal((await activeWindow()).title, titleB);
});

test('Browser Agent executa tabs/select/snapshot/click/type/back/forward/reload com verificação', { skip: process.platform !== 'win32', timeout: 70000 }, async t => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url === '/two') {
      res.end('<!doctype html><title>Página 2</title><main>SEGUNDA-PAGINA</main>');
      return;
    }
    res.end('<!doctype html><title>Página 1</title><main><input aria-label="Nome" value=""><input aria-label="Senha" type="password" value="nao-expor"><button id="toggle">Alternar</button><span id="state">estado-0</span><a href="/two">Próxima página</a><script>document.querySelector("#toggle").onclick=()=>{window.__toggle=(window.__toggle||0)+1;document.querySelector("#state").textContent="estado-"+window.__toggle}</script></main>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const cfg = { browser: { debugPort: 9333 + Math.floor(Math.random() * 200), profileDir: `${process.env.RUNNER_TEMP || process.env.TEMP}\\sexta-browser-${Date.now()}` } };
  const root = `http://127.0.0.1:${port}/`;

  const opened = await browserOpen(cfg, root);
  assert.equal(opened.verified, true);
  assert.equal(opened.after.url, root);
  const tabState = await browserTabs(cfg);
  assert.ok(tabState.tabs.length >= 1);
  const currentTab = tabState.tabs.find(tab => tab.id === opened.tabId) || tabState.tabs.find(tab => tab.selected);
  assert.ok(currentTab);
  const selected = await browserSelectTab(cfg, currentTab.index);
  assert.equal(selected.selected, true);
  assert.equal(selected.verified, true);
  assert.equal(selected.id, currentTab.id);

  const snap = await browserSnapshot(cfg);
  const password = snap.elements.find(el => el.password);
  assert.ok(password);
  assert.doesNotMatch(String(password.text), /nao-expor/);

  const typedStep = await browserActOnFreshElement(cfg, s => s.elements.find(el => el.tag === 'input' && !el.password), el => browserType(cfg, el.index, 'Lucas'));
  assert.equal(typedStep.result.verified, true);
  await assert.rejects(() => browserClick(cfg, typedStep.element.index), /PC_BROWSER_SNAPSHOT_REQUIRED|PC_BROWSER_STALE_SNAPSHOT/);

  const clickStep = await browserActOnFreshElement(cfg, s => s.elements.find(el => el.text === 'Alternar'), el => browserClick(cfg, el.index));
  assert.equal(clickStep.result.verified, true);
  await browserActOnFreshElement(cfg, s => s.elements.find(el => el.text === 'Próxima página'), el => browserClick(cfg, el.index));
  await waitFor(async () => (await browserSnapshot(cfg)).url.endsWith('/two'));

  const back = await browserBack(cfg);
  assert.equal(back.verified, true);
  assert.equal(back.after.url, root);
  const forward = await browserForward(cfg);
  assert.equal(forward.verified, true);
  assert.ok(forward.after.url.endsWith('/two'));
  const reload = await browserReload(cfg);
  assert.equal(reload.verified, true);
});
