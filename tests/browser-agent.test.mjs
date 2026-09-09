import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as browser from '../agent/browser-agent.mjs';

const executable = process.env.SEXTA_TEST_BROWSER;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function freePort() { const server = net.createServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r)); const port=server.address().port; await new Promise(r=>server.close(r)); return port; }
const page = `<!doctype html><title>SEXTA fixture</title><h1>Home</h1>
<button id="settings" onclick="document.querySelector('h1').textContent='Configurações'">Configurações</button>
<label>Pesquisar<input id="search"></label><input type="password" value="SECRET-NEVER-EXPOSE">
<a href="/second">Projetos</a><button onclick="window.didPay=true">Pagar</button>
<form><button>Continuar</button></form><button id="noop">Nada</button>
<button onclick="document.querySelector('#settings').remove()">Alterar</button>`;

test('real CDP: observe, act, verify; stale IDs and sensitive controls fail closed', {skip: !executable && 'Set SEXTA_TEST_BROWSER to a real Chrome/Edge/Chromium executable', timeout: 90000}, async t => {
  const server = http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(req.url==='/second'?'<title>Second</title><h1>Envista</h1>':page);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port = await freePort();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'sexta-cdp-test-'));
  const child=spawn(executable,['--headless=new','--no-sandbox',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
  let launchError; child.on('error',e=>{launchError=e;});
  t.after(async()=>{child.kill();await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200}).catch(()=>{});});
  let ready=false;
  for(let i=0;i<80;i++){if(launchError)throw launchError; try{ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{} if(ready)break;await delay(100);}
  assert.ok(ready,'real browser must start');
  const cfg={browser:{debugPort:port}};
  const url=`http://127.0.0.1:${server.address().port}/`;
  const ok=r=>{assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.verified,true);return r;};
  const opened=ok(await browser.browserOpen(cfg,url)); assert.equal(opened.url,url);
  assert.equal((await browser.browserOpen(cfg,'file:///etc/passwd')).ok,false);
  let tabs=ok(await browser.browserTabs(cfg));assert.ok(tabs.tabs.some(t=>t.selected));
  ok(await browser.browserSelectTab(cfg,0));
  assert.equal((await browser.browserSelectTab(cfg,-1)).ok,false);
  let snap=ok(await browser.browserSnapshot(cfg));assert.doesNotMatch(JSON.stringify(snap),/SECRET-NEVER-EXPOSE/);
  const id=text=>snap.elements.find(e=>e.text===text)?.index;
  const original=id('Configurações');
  const clicked=ok(await browser.browserClick(cfg,original));assert.match(clicked.after.text,/Configurações/);
  assert.equal((await browser.browserClick(cfg,original)).ok,false,'old snapshot IDs are invalid');
  snap=ok(await browser.browserSnapshot(cfg));
  const typed=ok(await browser.browserType(cfg,id('Pesquisar'),'React'));assert.equal(typed.typed,true);
  snap=ok(await browser.browserSnapshot(cfg));
  assert.match((await browser.browserType(cfg,snap.elements.find(e=>e.type==='password').index,'Lucas')).error,/PASSWORD/);
  assert.match((await browser.browserClick(cfg,id('Pagar'))).error,/SENSITIVE/);
  assert.match((await browser.browserClick(cfg,id('Continuar'))).error,/SENSITIVE/);
  assert.equal((await browser.browserClick(cfg,-1)).ok,false);
  ok(await browser.browserClick(cfg,id('Projetos')));
  ok(await browser.browserBack(cfg));
  assert.equal(ok(await browser.browserForward(cfg)).after.url,`${url}second`);
  assert.match((await browser.browserForward(cfg)).error,/HISTORY_BOUNDARY/);
  const reloaded=ok(await browser.browserReload(cfg));assert.notEqual(reloaded.before.documentId,reloaded.after.documentId);
  ok(await browser.browserBack(cfg));snap=ok(await browser.browserSnapshot(cfg));
  assert.equal((await browser.browserClick(cfg,id('Nada'))).ok,false,'a dispatched no-op is not success');
});
