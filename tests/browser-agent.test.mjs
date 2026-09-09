import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as browser from '../agent/browser-agent.mjs';
import { fileURLToPath } from 'node:url';
import heartbeatHandler from '../api/device-heartbeat.js';
import pollHandler from '../api/agent-poll.js';
import resultHandler from '../api/agent-result.js';
import { getDevices } from '../lib/core.mjs';
import { executePcDesktopTool } from '../lib/pc-desktop-tools.mjs';

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
  const routes = new Map([['/api/device-heartbeat',heartbeatHandler],['/api/agent-poll',pollHandler],['/api/agent-result',resultHandler]]);
  const server = http.createServer((req,res)=>{const route=routes.get(new URL(req.url,'http://localhost').pathname);if(route){route(req,res).catch(e=>{res.statusCode=500;res.end(e.message);});return;}res.setHeader('Content-Type','text/html; charset=utf-8'); res.end(req.url==='/second'?'<title>Second</title><h1>Envista</h1>':page);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const port = await freePort();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(),'sexta-cdp-test-'));
  const child=spawn(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:['ignore','ignore','pipe']});
  let browserErrors='';child.stderr.on('data',chunk=>{browserErrors=(browserErrors+chunk).slice(-6000);});
  let launchError; child.on('error',e=>{launchError=e;});
  t.after(async()=>{child.kill();await new Promise(r=>server.close(r));await fs.rm(profile,{recursive:true,force:true,maxRetries:4,retryDelay:200}).catch(()=>{});});
  let ready=false;
  for(let i=0;i<200;i++){if(launchError)throw launchError; try{ready=(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{} if(ready)break;await delay(100);}
  assert.ok(ready,`real browser must start (exit=${child.exitCode}): ${browserErrors}`);
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
  await t.test('real Web Core queue -> authenticated poll -> PC Agent -> CDP -> result', async () => {
    // Mount production API handlers and launch the production Agent. No fake command acknowledgments.
    const configPath=path.join(profile,'agent-config.json');
    const statePath=path.join(profile,'agent-state.json');
    await fs.writeFile(configPath,JSON.stringify(cfg));
    await fs.writeFile(statePath,JSON.stringify({autonomy:'autonomous',privacy:{hardware:false}}));
    const deviceId=`test-agent-${process.pid}`;
    const agent=spawn(process.execPath,[fileURLToPath(new URL('../agent/agent-v3.mjs',import.meta.url))],{
      env:{...process.env,SEXTA_BASE_URL:url.slice(0,-1),SEXTA_DEVICE_ID:deviceId,SEXTA_AGENT_CONFIG:configPath,SEXTA_AGENT_STATE:statePath,SEXTA_AGENT_AUDIT:path.join(profile,'audit.log'),SEXTA_SECURE_VAULT:path.join(profile,'vault.json')},stdio:'ignore'
    });
    try {
      let online=false;
      for(let i=0;i<70;i++){online=(await getDevices()).some(d=>d.device_id===deviceId&&d.online);if(online)break;await delay(100);}
      assert.ok(online,'Agent must heartbeat through production handler');
      const run=(name,args={})=>executePcDesktopTool(name,args,{agentInternal:true});
      ok(await run('pc_browser_open',{url}));
      let observed=ok(await run('pc_browser_snapshot')).result;
      const field=observed.elements.find(e=>e.id==='search').index;
      ok(await run('pc_browser_type',{index:field,text:'Lucas'}));
      observed=ok(await run('pc_browser_snapshot')).result;
      const failed=await run('pc_browser_click',{index:observed.elements.find(e=>e.text==='Pagar').index});
      assert.equal(failed.ok,false);assert.equal(failed.state,'failed');assert.equal(failed.result.verified,false);
    } finally { agent.kill(); }
  });
});
