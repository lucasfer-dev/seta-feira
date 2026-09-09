import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { browserBack, browserClick, browserForward, browserOpen, browserReload, browserSelectTab, browserSnapshot, browserTabs, browserType } from '../agent/browser-agent.mjs';
import { activeWindow, focusWindow, uiClickText, uiTree, uiTypeText, windowList } from '../agent/windows-ui.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, { timeout = 15000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout; let lastError;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch (error) { lastError = error; } await sleep(interval); }
  if (lastError) throw lastError; throw new Error('WAIT_TIMEOUT');
}
async function browserActOnFreshElement(cfg, findElement, action, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = await browserSnapshot(cfg);
    const element = findElement(snapshot);
    assert.ok(element, `Elemento semântico não encontrado em ${snapshot.url || 'página desconhecida'}`);
    try { return { snapshot, element, result: await action(element, snapshot) }; }
    catch (error) {
      lastError = error;
      if (!/PC_BROWSER_STALE_SNAPSHOT|PC_BROWSER_STATE_UNAVAILABLE/.test(String(error?.message || error))) throw error;
      await sleep(180);
    }
  }
  throw lastError || new Error('PC_BROWSER_SEMANTIC_RETRY_EXHAUSTED');
}
function startUiFixture(title, state = 'Minimized') {
  const safe = title.replace(/'/g, "''");
  const safeState = ['Minimized', 'Maximized', 'Normal'].includes(state) ? state : 'Normal';
  const config64 = Buffer.from('Configurações', 'utf8').toString('base64');
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$configText=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${config64}'))
$form=New-Object System.Windows.Forms.Form;$form.Text='${safe}';$form.Width=500;$form.Height=300
$name=New-Object System.Windows.Forms.TextBox;$name.Left=20;$name.Top=30;$name.Width=260;$name.AccessibleName='Nome'
$echo=New-Object System.Windows.Forms.Label;$echo.Left=20;$echo.Top=70;$echo.Width=300;$echo.Text='typed:';$name.Add_TextChanged({$echo.Text='typed:'+$name.Text})
$pass=New-Object System.Windows.Forms.TextBox;$pass.Left=20;$pass.Top=110;$pass.Width=260;$pass.AccessibleName='Senha';$pass.UseSystemPasswordChar=$true
$button=New-Object System.Windows.Forms.Button;$button.Left=20;$button.Top=160;$button.Width=160;$button.Text=$configText;$button.AccessibleName=$configText;$button.Add_Click({$form.Text='Clicked ${safe}'})
$form.Controls.AddRange(@($name,$echo,$pass,$button));$form.WindowState=[System.Windows.Forms.FormWindowState]::${safeState};[void]$form.ShowDialog()
`;
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','-'],{stdio:['pipe','ignore','pipe'],windowsHide:false}); child.stdin.end(script,'utf8'); return child;
}

test('Windows Hands restores/focuses and drives UI Automation sem senha', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const unique=`SEXTA Hands ${Date.now()}`; const fixture=startUiFixture(unique); t.after(()=>{try{fixture.kill();}catch{}});
  await waitFor(async()=> (await windowList(30)).windows.some(win=>String(win.title).includes(unique)));
  const focused=await focusWindow(unique); assert.equal(focused.focused,true); assert.equal(focused.verified,true); assert.equal(focused.restored,true);
  const active=await activeWindow(); assert.ok(String(active.title).includes(unique));
  const tree=await uiTree(180);
  const diagnostic=JSON.stringify({window:tree.window,count:tree.count,enumerated:tree.enumerated,provider:tree.provider,nodes:(tree.nodes||[]).slice(0,60)});
  assert.ok(tree.nodes.some(node=>node.name==='Configurações'), diagnostic);
  assert.ok(tree.nodes.some(node=>node.name==='Nome'), diagnostic);
  assert.ok(tree.nodes.some(node=>node.password===true||node.name==='[password]'), diagnostic);
  const clicked=await uiClickText('Configurações'); assert.equal(clicked.clicked,true); await waitFor(async()=>String((await activeWindow()).title).startsWith('Clicked '));
  const typed=await uiTypeText('Lucas','Nome'); assert.equal(typed.typed,true); assert.equal(typed.verified,true); await waitFor(async()=> (await uiTree(180)).nodes.some(node=>node.name==='typed:Lucas'));
  await assert.rejects(()=>uiTypeText('segredo','Senha'),/PC_UI_PASSWORD_FIELD_BLOCKED/);
});

test('Windows Hands focuses maximized windows and resolves exact title among similar windows', { skip: process.platform !== 'win32', timeout: 45000 }, async t => {
  const prefix=`SEXTA Similar ${Date.now()}`;
  const titleA=`${prefix} Alpha`;
  const titleB=`${prefix} Beta`;
  const fixtureA=startUiFixture(titleA,'Maximized');
  const fixtureB=startUiFixture(titleB,'Normal');
  t.after(()=>{for(const child of [fixtureA,fixtureB]){try{child.kill();}catch{}}});
  await waitFor(async()=>{
    const windows=(await windowList(30)).windows;
    return windows.some(win=>win.title===titleA)&&windows.some(win=>win.title===titleB);
  });
  const focusedA=await focusWindow(titleA);
  assert.equal(focusedA.verified,true);
  assert.equal(focusedA.title,titleA);
  assert.equal(focusedA.restored,false);
  assert.ok(focusedA.ambiguousMatches>=1);
  assert.equal((await activeWindow()).title,titleA);
  const focusedB=await focusWindow(titleB);
  assert.equal(focusedB.verified,true);
  assert.equal(focusedB.title,titleB);
  assert.equal((await activeWindow()).title,titleB);
});

test('Browser Agent executa tabs/select/snapshot/click/type/back/forward/reload com verificação', { skip: process.platform !== 'win32', timeout: 60000 }, async t => {
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');if(req.url==='/two'){res.end('<!doctype html><title>Página 2</title><main>SEGUNDA-PAGINA</main>');return;}res.end(`<!doctype html><title>Página 1</title><main><input aria-label="Nome" value=""><input aria-label="Senha" type="password" value="nao-expor"><button id="toggle">Alternar</button><span id="state">estado-0</span><a href="/two">Próxima página</a><script>document.querySelector('#toggle').onclick=()=>{window.__toggle=(window.__toggle||0)+1;document.querySelector('#state').textContent='estado-'+window.__toggle}</script></main>`);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>server.close()); const {port}=server.address();
  const cfg={browser:{debugPort:9333+Math.floor(Math.random()*200),profileDir:`${process.env.RUNNER_TEMP||process.env.TEMP}\\sexta-browser-${Date.now()}`}}; const root=`http://127.0.0.1:${port}/`;
  const opened=await browserOpen(cfg,root); assert.equal(opened.verified,true); assert.equal(opened.after.url,root);
  const tabState=await browserTabs(cfg); assert.ok(tabState.tabs.length>=1); const currentTab=tabState.tabs.find(tab=>tab.id===opened.tabId)||tabState.tabs.find(tab=>tab.selected); assert.ok(currentTab);
  const selected=await browserSelectTab(cfg,currentTab.index); assert.equal(selected.selected,true); assert.equal(selected.verified,true); assert.equal(selected.id,currentTab.id);

  let snap=await browserSnapshot(cfg); const password=snap.elements.find(el=>el.password); assert.ok(password); assert.doesNotMatch(String(password.text),/nao-expor/);
  const typedStep=await browserActOnFreshElement(cfg, s=>s.elements.find(el=>el.tag==='input'&&!el.password), el=>browserType(cfg,el.index,'Lucas'));
  assert.equal(typedStep.result.verified,true);
  await assert.rejects(()=>browserClick(cfg,typedStep.element.index),/PC_BROWSER_SNAPSHOT_REQUIRED|PC_BROWSER_STALE_SNAPSHOT/);

  const clickStep=await browserActOnFreshElement(cfg, s=>s.elements.find(el=>el.text==='Alternar'), el=>browserClick(cfg,el.index));
  assert.equal(clickStep.result.verified,true);
  await browserActOnFreshElement(cfg, s=>s.elements.find(el=>el.text==='Próxima página'), el=>browserClick(cfg,el.index));
  await waitFor(async()=> (await browserSnapshot(cfg)).url.endsWith('/two'));

  const back=await browserBack(cfg); assert.equal(back.verified,true); assert.equal(back.after.url,root);
  const forward=await browserForward(cfg); assert.equal(forward.verified,true); assert.ok(forward.after.url.endsWith('/two'));
  const reload=await browserReload(cfg); assert.equal(reload.verified,true);
});
