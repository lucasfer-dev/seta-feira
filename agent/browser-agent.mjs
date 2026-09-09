import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browserProcess = null;
let selectedTargetId = null;
const snapshots = new Map();
const tabListings = new Map();

function browserPort(cfg = {}) { return Math.max(1025, Math.min(65534, Number(cfg.browser?.debugPort) || 9223)); }
function browserProfile(cfg = {}) { return path.resolve(String(cfg.browser?.profileDir || path.join(os.homedir(), '.sexta-browser-profile'))); }
function selectionPath(port) { return path.join(os.tmpdir(), `sexta-browser-selected-${Number(port) || 9223}.txt`); }
function readPersistedSelection(port) { try { return String(fs.readFileSync(selectionPath(port), 'utf8') || '').trim(); } catch { return ''; } }
function setSelectedTarget(port, id) { const targetId = String(id || '').trim(); selectedTargetId = targetId || null; if (!targetId) return; try { fs.writeFileSync(selectionPath(port), targetId, 'utf8'); } catch {} }
function executableCandidates(cfg = {}) {
  const configured = String(cfg.browser?.command || '').trim();
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [configured, path.join(pfx86,'Microsoft','Edge','Application','msedge.exe'), path.join(pf,'Microsoft','Edge','Application','msedge.exe'), path.join(pf,'Google','Chrome','Application','chrome.exe'), path.join(pfx86,'Google','Chrome','Application','chrome.exe'), path.join(local,'Google','Chrome','Application','chrome.exe')].filter(Boolean);
}
function resolveBrowserExecutable(cfg = {}) { for (const candidate of executableCandidates(cfg)) { if (/[/\\]/.test(candidate)) { if (fs.existsSync(candidate)) return candidate; } else return candidate; } throw new Error('PC_BROWSER_NOT_FOUND'); }
async function debugReady(port) { try { const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(900) }); return response.ok; } catch { return false; } }
async function ensureBrowser(cfg = {}) {
  if (process.platform !== 'win32') throw new Error('PC_BROWSER_WINDOWS_ONLY');
  const port = browserPort(cfg); if (await debugReady(port)) return port;
  const executable = resolveBrowserExecutable(cfg); const profile = browserProfile(cfg); fs.mkdirSync(profile, { recursive: true });
  browserProcess = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore', windowsHide: false }); browserProcess.unref();
  for (let i = 0; i < 35; i += 1) { if (await debugReady(port)) return port; await sleep(180); }
  throw new Error('PC_BROWSER_DEBUG_NOT_READY');
}
async function pageTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1800) });
  if (!response.ok) throw new Error(`PC_BROWSER_TARGETS_${response.status}`);
  const targets = await response.json();
  return (Array.isArray(targets) ? targets : []).filter(item => item?.type === 'page' && item?.webSocketDebuggerUrl && !String(item.url || '').startsWith('devtools://'));
}
function usefulPage(page = {}) { const url = String(page.url || ''); return Boolean(url && url !== 'about:blank' && !url.startsWith('chrome://') && !url.startsWith('edge://')); }
function urlMatches(actual = '', expected = '') {
  if (!expected) return true;
  try { const a = new URL(actual); const e = new URL(expected); return a.href === e.href || (a.origin === e.origin && a.pathname === e.pathname); } catch { return actual === expected; }
}
async function resolveTarget(port, preferredId = '', expectedUrl = '') {
  const pages = await pageTargets(port); if (!pages.length) throw new Error('PC_BROWSER_NO_PAGE');
  const persisted = preferredId || selectedTargetId || readPersistedSelection(port);
  let target = persisted ? pages.find(item => item.id === persisted) : null;
  if (!target && preferredId) throw new Error('PC_BROWSER_TARGET_GONE');
  if (!target && expectedUrl) target = pages.find(item => urlMatches(String(item.url || ''), expectedUrl)) || null;
  if (!target) target = pages.find(usefulPage) || pages[0];
  setSelectedTarget(port, target.id); return target;
}
async function pageTarget(port) { return resolveTarget(port); }
async function activateTarget(port, id) {
  const targetId = String(id || ''); if (!targetId) throw new Error('PC_BROWSER_TAB_ID_REQUIRED');
  if (selectedTargetId === targetId) { setSelectedTarget(port, targetId); return true; }
  const response = await fetch(`http://127.0.0.1:${port}/json/activate/${encodeURIComponent(targetId)}`, { signal: AbortSignal.timeout(1800) });
  if (!response.ok) throw new Error(`PC_BROWSER_TAB_ACTIVATE_${response.status}`); setSelectedTarget(port, targetId); return true;
}
async function cdpCall(port, method, params = {}, preferredTargetId = '') {
  const target = await resolveTarget(port, preferredTargetId); const Ws = globalThis.WebSocket; if (!Ws) throw new Error('PC_BROWSER_WEBSOCKET_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    const ws = new Ws(target.webSocketDebuggerUrl); const id = Math.floor(Math.random() * 1_000_000) + 1;
    const timer = setTimeout(() => { try { ws.close(); } catch {}; reject(new Error(`PC_BROWSER_CDP_TIMEOUT:${method}`)); }, 8000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('PC_BROWSER_CDP_SOCKET_FAILED')); });
    ws.addEventListener('message', event => { let message; try { message = JSON.parse(String(event.data || '')); } catch { return; } if (message.id !== id) return; clearTimeout(timer); try { ws.close(); } catch {}; if (message.error) reject(new Error(`PC_BROWSER_CDP_${message.error.code}:${message.error.message}`)); else resolve(message.result || {}); });
  });
}
function parseEval(result) { const value = result?.result?.value; if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } } return value; }
async function evaluate(port, expression, returnByValue = true, preferredTargetId = '') { return cdpCall(port, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue, userGesture: true }, preferredTargetId); }
async function browserState(port, preferredTargetId = '') {
  const target = await resolveTarget(port, preferredTargetId);
  const raw = await evaluate(port, `(() => JSON.stringify({url:location.href,title:document.title,readyState:document.readyState,timeOrigin:performance.timeOrigin||0,historyLength:history.length,textMarker:String(document.body?.innerText||'').replace(/\\s+/g,' ').trim().slice(0,1800),active:(()=>{const e=document.activeElement;return e?[e.tagName,e.id,e.getAttribute('name'),e.getAttribute('aria-label')].filter(Boolean).join('|'):'';})()}))())`, true, target.id);
  return { ...(parseEval(raw) || {}), targetId: target.id };
}
async function stableBrowserState(port, targetId = '', timeoutMs = 1800) {
  const deadline = Date.now() + timeoutMs; let last = {}; let lastError = '';
  while (Date.now() < deadline) {
    try {
      const state = await browserState(port, targetId);
      if (state?.url && (state.readyState === 'interactive' || state.readyState === 'complete')) {
        if (last.url === state.url && last.timeOrigin === state.timeOrigin) return state;
        last = state;
      }
    } catch (error) { lastError = String(error?.message || error); }
    await sleep(90);
  }
  if (last?.url) return last;
  throw new Error(`PC_BROWSER_STATE_UNAVAILABLE${lastError ? `:${lastError}` : ''}`);
}
function stateChanged(before = {}, after = {}) { return before.url !== after.url || before.title !== after.title || before.timeOrigin !== after.timeOrigin || before.textMarker !== after.textMarker || before.active !== after.active; }
async function waitForStateChange(port, before, timeoutMs = 2800, targetId = '') {
  const deadline = Date.now() + timeoutMs; let after = before;
  while (Date.now() < deadline) { try { after = await browserState(port, targetId); if (stateChanged(before, after)) return { changed: true, after }; } catch {} await sleep(100); }
  try { after = await browserState(port, targetId); } catch {} return { changed: stateChanged(before, after), after };
}
function normalizeHttpUrl(rawUrl) { const input = String(rawUrl || '').trim(); if (!input) throw new Error('PC_BROWSER_URL_REQUIRED'); const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`; const url = new URL(candidate); if (!['http:','https:'].includes(url.protocol)) throw new Error('PC_BROWSER_URL_BLOCKED'); return url; }
const SENSITIVE = /\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|subscribe)\b/i;
function invalidateSnapshot(targetId) { if (targetId) snapshots.delete(String(targetId)); }
async function waitForNavigation(port, { targetId = '', before = {}, expectedUrl = '', timeoutMs = 8000, requireNewDocument = false } = {}) {
  const deadline = Date.now() + timeoutMs; let after = {}; let currentTargetId = targetId; let lastError = '';
  while (Date.now() < deadline) {
    try {
      const target = await resolveTarget(port, currentTargetId, expectedUrl); currentTargetId = target.id;
      const targetUrl = String(target.url || '');
      if (expectedUrl && !urlMatches(targetUrl, expectedUrl)) { await sleep(120); continue; }
      after = await browserState(port, currentTargetId);
      const ready = after.readyState === 'interactive' || after.readyState === 'complete';
      const urlOk = !expectedUrl || urlMatches(after.url, expectedUrl);
      const documentOk = !requireNewDocument || after.timeOrigin !== before.timeOrigin;
      if (ready && urlOk && documentOk) return after;
    } catch (error) { lastError = String(error?.message || error); }
    await sleep(120);
  }
  if (!after.url && expectedUrl) { try { const target = await resolveTarget(port, currentTargetId, expectedUrl); after = { url: target.url, title: target.title || '', readyState: 'unknown', targetId: target.id, diagnosticError: lastError }; } catch {} }
  return after;
}

export async function browserOpen(cfg, rawUrl) {
  const url = normalizeHttpUrl(rawUrl); const port = await ensureBrowser(cfg); const target = await pageTarget(port); const before = await browserState(port, target.id).catch(() => ({ url: target.url, title: target.title, timeOrigin: 0, targetId: target.id })); invalidateSnapshot(target.id);
  await cdpCall(port, 'Page.enable', {}, target.id).catch(() => {}); const result = await cdpCall(port, 'Page.navigate', { url: url.toString() }, target.id);
  const after = await waitForNavigation(port, { targetId: target.id, before, expectedUrl: url.toString(), timeoutMs: 9000 }); if (after.targetId) await activateTarget(port, after.targetId).catch(() => {});
  const verified = Boolean(after.url && urlMatches(after.url, url.toString())); if (!verified) throw new Error(`PC_BROWSER_NAVIGATION_NOT_VERIFIED:${after.url || 'unknown'}${after.diagnosticError ? `:${after.diagnosticError}` : ''}`);
  return { opened: after.url, requestedUrl: url.toString(), frameId: result.frameId || null, tabId: after.targetId || target.id, port, profile: browserProfile(cfg), verified, before, after };
}
export async function browserTabs(cfg) {
  const port = await ensureBrowser(cfg); const pages = await pageTargets(port); if (!pages.length) throw new Error('PC_BROWSER_NO_PAGE'); const persisted = selectedTargetId || readPersistedSelection(port); if (!persisted || !pages.some(page => page.id === persisted)) setSelectedTarget(port, (pages.find(usefulPage) || pages[0]).id); else selectedTargetId = persisted;
  const tabs = pages.slice(0,24).map((page,index)=>({index,id:page.id,title:String(page.title||'').slice(0,240),url:String(page.url||'').slice(0,1000),selected:page.id===selectedTargetId}));
  tabListings.set(port,{ ids: tabs.map(tab=>tab.id), createdAt: Date.now() });
  return { selectedTargetId, tabs };
}
export async function browserSelectTab(cfg,index) {
  const port=await ensureBrowser(cfg); const i=Math.max(0,Math.floor(Number(index)||0)); const listing=tabListings.get(port); const pages=await pageTargets(port);
  const targetId=listing?.ids?.[i] || pages[i]?.id || ''; if(!targetId)throw new Error('PC_BROWSER_TAB_NOT_FOUND'); const target=pages.find(page=>page.id===targetId); if(!target)throw new Error('PC_BROWSER_STALE_TAB_LIST');
  const wasSelected=selectedTargetId===target.id; invalidateSnapshot(target.id); if(!wasSelected){await activateTarget(port,target.id);await sleep(140);}else{setSelectedTarget(port,target.id);}
  const selected=(await pageTargets(port)).find(page=>page.id===target.id); if(!selected||selectedTargetId!==target.id)throw new Error('PC_BROWSER_TAB_SELECTION_NOT_VERIFIED');
  return{selected:true,verified:true,index:i,id:target.id,title:String(selected.title||'').slice(0,240),url:String(selected.url||'').slice(0,1000),reused:wasSelected};
}
export async function browserSnapshot(cfg) {
  const port=await ensureBrowser(cfg); const target=await pageTarget(port); const state=await stableBrowserState(port,target.id,3000); const token=crypto.randomBytes(8).toString('hex'); const encodedToken=JSON.stringify(token);
  const expression=`(() => {const token=${encodedToken};const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&r.width>0&&r.height>0;};const nodes=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"]')].filter(visible).slice(0,140);const elements=nodes.map((el,index)=>{const type=String(el.getAttribute('type')||'').toLowerCase();const password=type==='password';const ref=token+':'+index;el.setAttribute('data-sexta-ref',ref);const safeValue=password?'':String(el.value||'');const text=String(el.innerText||safeValue||el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('placeholder')||'').replace(/\\s+/g,' ').trim().slice(0,240);return{index,ref,tag:el.tagName.toLowerCase(),role:el.getAttribute('role')||'',type,password,text,name:String(el.getAttribute('name')||'').slice(0,120),id:String(el.id||'').slice(0,120),disabled:Boolean(el.disabled),href:el.tagName==='A'?String(el.href||'').slice(0,500):''};});return JSON.stringify({title:document.title,url:location.href,text:String(document.body?.innerText||'').replace(/\\n{3,}/g,'\\n\\n').slice(0,14000),elements});})()`;
  const data=parseEval(await evaluate(port,expression,true,target.id))||{}; snapshots.set(target.id,{token,url:data.url||state.url,timeOrigin:state.timeOrigin,elements:Array.isArray(data.elements)?data.elements:[],createdAt:Date.now()}); return{...data,tabId:target.id,snapshotId:token,documentTimeOrigin:state.timeOrigin};
}
async function snapshotElement(port,index) {
  const target=await pageTarget(port); const snapshot=snapshots.get(target.id); if(!snapshot)throw new Error('PC_BROWSER_SNAPSHOT_REQUIRED'); const current=await stableBrowserState(port,target.id,2200);
  const staleUrl=!urlMatches(current.url,snapshot.url); const staleDocument=Boolean(snapshot.timeOrigin&&current.timeOrigin&&snapshot.timeOrigin!==current.timeOrigin); if(staleUrl||staleDocument){invalidateSnapshot(target.id);throw new Error(`PC_BROWSER_STALE_SNAPSHOT:${snapshot.url || 'unknown'}=>${current.url || 'unknown'}`);}
  const i=Math.max(0,Math.floor(Number(index)||0)); const saved=snapshot.elements.find(element=>Number(element.index)===i); if(!saved?.ref)throw new Error('PC_BROWSER_ELEMENT_NOT_FOUND'); const ref=JSON.stringify(saved.ref);
  const expression=`(() => {const ref=${ref};const el=[...document.querySelectorAll('[data-sexta-ref]')].find(node=>node.getAttribute('data-sexta-ref')===ref);if(!el)return JSON.stringify({found:false});const type=String(el.getAttribute('type')||'').toLowerCase();const password=type==='password';const safeValue=password?'':String(el.value||'');return JSON.stringify({found:true,ref,tag:el.tagName.toLowerCase(),type,password,text:String(el.innerText||safeValue||el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('placeholder')||'').replace(/\\s+/g,' ').trim().slice(0,300),disabled:Boolean(el.disabled)});})()`;
  const meta=parseEval(await evaluate(port,expression,true,target.id)); if(!meta?.found){invalidateSnapshot(target.id);throw new Error('PC_BROWSER_STALE_SNAPSHOT:ELEMENT_GONE');} return{target,snapshot,index:i,saved,meta};
}
export async function browserClick(cfg,index) {
  const port=await ensureBrowser(cfg); const{target,saved,meta,index:i}=await snapshotElement(port,index); if(meta.disabled)throw new Error('PC_BROWSER_ELEMENT_DISABLED'); if(!String(meta.text||'').trim())throw new Error('PC_BROWSER_UNLABELED_CONTROL_BLOCKED'); if(SENSITIVE.test(String(meta.text||'')))throw new Error('PC_BROWSER_SENSITIVE_CONTROL_BLOCKED');
  const before=await browserState(port,target.id); const ref=JSON.stringify(saved.ref); const clicked=parseEval(await evaluate(port,`(() => {const ref=${ref};const el=[...document.querySelectorAll('[data-sexta-ref]')].find(node=>node.getAttribute('data-sexta-ref')===ref);if(!el)return false;el.scrollIntoView({block:'center',inline:'center'});el.focus();el.click();return true;})()`,true,target.id)); invalidateSnapshot(target.id); if(!clicked)throw new Error('PC_BROWSER_CLICK_FAILED'); const observed=await waitForStateChange(port,before,3000,target.id); return{clicked:true,index:i,element:meta,verified:observed.changed,before,after:observed.after,verification:observed.changed?'state_changed':'action_dispatched_no_observable_change',snapshotInvalidated:true};
}
export async function browserType(cfg,index,text) {
  const port=await ensureBrowser(cfg); const{target,saved,meta,index:i}=await snapshotElement(port,index); if(meta.disabled)throw new Error('PC_BROWSER_ELEMENT_DISABLED'); if(meta.password||String(meta.type||'').toLowerCase()==='password')throw new Error('PC_BROWSER_PASSWORD_FIELD_BLOCKED'); const value=String(text||'').slice(0,4000); const ref=JSON.stringify(saved.ref); const encoded=JSON.stringify(value);
  const result=parseEval(await evaluate(port,`(() => {const ref=${ref};const el=[...document.querySelectorAll('[data-sexta-ref]')].find(node=>node.getAttribute('data-sexta-ref')===ref);if(!el)return JSON.stringify({found:false});el.scrollIntoView({block:'center'});el.focus();const value=${encoded};if(el.isContentEditable){el.textContent=value;}else if(el.tagName==='SELECT'){const option=[...el.options].find(o=>o.value===value||o.text===value);if(!option)return JSON.stringify({found:true,typed:false});el.value=option.value;}else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');if(d?.set)d.set.call(el,value);else el.value=value;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));const actual=el.isContentEditable?String(el.textContent||''):String(el.value||'');return JSON.stringify({found:true,typed:true,verified:actual===value,length:actual.length});})()`,true,target.id));
  invalidateSnapshot(target.id); if(!result?.found)throw new Error('PC_BROWSER_STALE_SNAPSHOT'); if(!result.typed||!result.verified)throw new Error('PC_BROWSER_TYPE_NOT_VERIFIED'); return{typed:true,verified:true,index:i,length:value.length,element:meta,snapshotInvalidated:true};
}
async function navigationHistory(port,targetId){return cdpCall(port,'Page.getNavigationHistory',{},targetId);}
async function navigateHistory(cfg,delta) {
  const port=await ensureBrowser(cfg); const target=await pageTarget(port); const before=await browserState(port,target.id); const history=await navigationHistory(port,target.id); const entries=Array.isArray(history.entries)?history.entries:[]; const nextIndex=Number(history.currentIndex)+delta; const entry=entries[nextIndex]; if(!entry)throw new Error(delta<0?'PC_BROWSER_NO_BACK_HISTORY':'PC_BROWSER_NO_FORWARD_HISTORY'); invalidateSnapshot(target.id); await cdpCall(port,'Page.navigateToHistoryEntry',{entryId:entry.id},target.id);
  const after=await waitForNavigation(port,{targetId:target.id,before,expectedUrl:entry.url,timeoutMs:8000}); const verified=urlMatches(after.url,entry.url)&&after.url!==before.url; if(!verified)throw new Error('PC_BROWSER_HISTORY_NAVIGATION_NOT_VERIFIED'); return{verified,before,after,entry:{id:entry.id,url:entry.url,title:entry.title||''},snapshotInvalidated:true};
}
export async function browserBack(cfg){return{back:true,...(await navigateHistory(cfg,-1))};}
export async function browserForward(cfg){return{forward:true,...(await navigateHistory(cfg,1))};}
export async function browserReload(cfg) {
  const port=await ensureBrowser(cfg); const target=await pageTarget(port); const before=await browserState(port,target.id); invalidateSnapshot(target.id); await cdpCall(port,'Page.reload',{ignoreCache:false},target.id); const after=await waitForNavigation(port,{targetId:target.id,before,expectedUrl:before.url,timeoutMs:9000,requireNewDocument:true}); const verified=urlMatches(after.url,before.url)&&after.timeOrigin!==before.timeOrigin; if(!verified)throw new Error('PC_BROWSER_RELOAD_NOT_VERIFIED'); return{reloaded:true,verified,before,after,snapshotInvalidated:true};
}
export function browserStatus(cfg={}) { const port=browserPort(cfg); const persisted=selectedTargetId||readPersistedSelection(port); return{configured:true,port,profile:browserProfile(cfg),processStarted:Boolean(browserProcess),selectedTargetId:persisted||null}; }
