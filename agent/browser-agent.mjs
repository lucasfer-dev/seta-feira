import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browserProcess = null;
let selectedTargetId = null;

function browserPort(cfg = {}) {
  return Math.max(1025, Math.min(65534, Number(cfg.browser?.debugPort) || 9223));
}

function browserProfile(cfg = {}) {
  return path.resolve(String(cfg.browser?.profileDir || path.join(os.homedir(), '.sexta-browser-profile')));
}

function selectionPath(port) {
  return path.join(os.tmpdir(), `sexta-browser-selected-${Number(port) || 9223}.txt`);
}

function readPersistedSelection(port) {
  try { return String(fs.readFileSync(selectionPath(port), 'utf8') || '').trim(); }
  catch { return ''; }
}

function setSelectedTarget(port, id) {
  const targetId = String(id || '').trim();
  selectedTargetId = targetId || null;
  if (!targetId) return;
  try { fs.writeFileSync(selectionPath(port), targetId, 'utf8'); } catch {}
}

function executableCandidates(cfg = {}) {
  const configured = String(cfg.browser?.command || '').trim();
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pfx86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [
    configured,
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
}

function resolveBrowserExecutable(cfg = {}) {
  const candidates = executableCandidates(cfg);
  for (const candidate of candidates) {
    if (/[/\\]/.test(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      return candidate;
    }
  }
  throw new Error('PC_BROWSER_NOT_FOUND');
}

async function debugReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(900) });
    return response.ok;
  } catch { return false; }
}

async function ensureBrowser(cfg = {}) {
  const port = browserPort(cfg);
  if (await debugReady(port)) return port;

  if (process.platform !== 'win32') throw new Error('PC_BROWSER_WINDOWS_ONLY');
  const executable = resolveBrowserExecutable(cfg);
  const profile = browserProfile(cfg);
  fs.mkdirSync(profile, { recursive: true });
  browserProcess = spawn(executable, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank'
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  let launchError;
  browserProcess.on('error', error => { launchError = error; });
  browserProcess.unref();

  for (let i = 0; i < 30; i += 1) {
    if (launchError) throw new Error(`PC_BROWSER_LAUNCH_FAILED:${launchError.message}`);
    if (await debugReady(port)) return port;
    await sleep(180);
  }
  throw new Error('PC_BROWSER_DEBUG_NOT_READY');
}

async function pageTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`PC_BROWSER_TARGETS_${response.status}`);
  const targets = await response.json();
  return (Array.isArray(targets) ? targets : []).filter(item => item?.type === 'page' && item?.webSocketDebuggerUrl && !String(item.url || '').startsWith('devtools://'));
}

function usefulPage(page = {}) {
  const url = String(page.url || '');
  return Boolean(url && url !== 'about:blank' && !url.startsWith('chrome://') && !url.startsWith('edge://'));
}

async function pageTarget(port) {
  const pages = await pageTargets(port);
  if (!pages.length) throw new Error('PC_BROWSER_NO_PAGE');
  const persisted = selectedTargetId || readPersistedSelection(port);
  const selected = persisted ? pages.find(item => item.id === persisted) : null;
  // Em processos duplicados/recém-reiniciados, não deixe uma about:blank roubar o
  // foco de uma página útil. A seleção também é persistida por porta para que
  // Browser Agent e Agent local compartilhem a mesma aba preferida.
  const target = selected
    ? selected
    : pages.find(usefulPage)
      || selected
      || pages[0];
  setSelectedTarget(port, target.id);
  return target;
}

async function activateTarget(port, id) {
  const targetId = String(id || '');
  if (!targetId) throw new Error('PC_BROWSER_TAB_ID_REQUIRED');
  const response = await fetch(`http://127.0.0.1:${port}/json/activate/${encodeURIComponent(targetId)}`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`PC_BROWSER_TAB_ACTIVATE_${response.status}`);
  setSelectedTarget(port, targetId);
  return true;
}

// Serialize actions so selection and snapshot ownership cannot race across commands.
let pending = Promise.resolve();
let nextIndex = 1;
const snapshots = new Map();
const SENSITIVE = /\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|subscribe|ok|yes|sim|accept|aceitar|allow|permitir|install|instalar)\b/i;

function failure(reason, observedState = {}) {
  return Object.assign(new Error(reason), { observedState });
}
function completed(action, before, after, extra = {}) {
  return { ok: true, state: 'completed', action, verified: true, before, after, ...extra };
}
function invalidate(port) { snapshots.delete(port); }

async function cdpCall(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try { ws.close(); } catch {}
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(failure(`PC_BROWSER_CDP_TIMEOUT:${method}`)), 3000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 1, method, params })));
    ws.addEventListener('error', () => finish(failure('PC_BROWSER_CDP_SOCKET_FAILED')));
    ws.addEventListener('close', () => finish(failure('PC_BROWSER_CDP_DISCONNECTED')));
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (message.id !== 1) return;
      finish(message.error ? failure(`PC_BROWSER_CDP:${message.error.message}`) : null, message.result);
    });
  });
}
async function evaluate(target, expression) {
  const response = await cdpCall(target, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw failure('PC_BROWSER_EVALUATION_FAILED');
  return response.result?.value;
}
const stateExpression = `(() => ({url:location.href,title:document.title,ready:document.readyState,
  documentId:performance.timeOrigin, text:(document.body?.innerText||'').slice(0,14000),
  controls:[...document.querySelectorAll('input:not([type=password]),textarea,select,[aria-expanded],[aria-selected],[aria-checked]')].slice(0,160).map(e=>[e.tagName,e.type==='password'?'':e.value,e.checked,e.getAttribute('aria-expanded'),e.getAttribute('aria-selected'),e.getAttribute('aria-checked')])}))()`;
async function observe(target) { return { ...await evaluate(target, stateExpression), tabId: target.id }; }
async function waitState(target, predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  let last, signature, stable = 0;
  do {
    try {
      last = await observe(target);
      const next = JSON.stringify(last);
      stable = next === signature ? stable + 1 : 0; signature = next;
      if (last.ready === 'complete' && predicate(last) && stable >= 2) return last;
    } catch { /* Read-only retries reconnect during navigation; never replay mutations. */ }
    await sleep(120);
  } while (Date.now() < deadline);
  throw failure('PC_BROWSER_VERIFICATION_TIMEOUT', last);
}
async function withPage(cfg, action, operation) {
  const task = pending.then(async () => {
    try {
      const port = await ensureBrowser(cfg);
      const target = await pageTarget(port);
      return await operation(port, target);
    } catch (error) {
      return { ok: false, state: 'failed', action, verified: false, error: error.message, reason: error.message, observedState: error.observedState || {} };
    }
  });
  pending = task.catch(() => {});
  return task;
}
function validIndex(index) {
  if (!Number.isInteger(index) || index < 0) throw failure('PC_BROWSER_INVALID_INDEX');
  return index;
}
export async function browserOpen(cfg, rawUrl) {
  return withPage(cfg, 'browser_open', async (port, target) => {
    const raw = String(rawUrl || '').trim();
    if (!raw) throw failure('PC_BROWSER_URL_REQUIRED');
    let url;
    try { url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`); } catch { throw failure('PC_BROWSER_URL_INVALID'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('PC_BROWSER_URL_BLOCKED');
    const before = await observe(target);
    invalidate(port);
    const result = await cdpCall(target, 'Page.navigate', { url: url.href });
    if (result.errorText || result.isDownload) throw failure(result.errorText || 'PC_BROWSER_DOWNLOAD_BLOCKED');
    const after = await waitState(target, s => s.url !== 'about:blank' && !s.url.startsWith('chrome-error:') && (s.documentId !== before.documentId || s.url === url.href));
    await activateTarget(port, target.id);
    const visible = await evaluate(target, 'document.visibilityState');
    if (visible !== 'visible') throw failure('PC_BROWSER_TAB_ACTIVATION_UNVERIFIED', after);
    return completed('browser_open', before, after, { opened: after.url, url: after.url, title: after.title, status: 'loaded', tabId: target.id, selectedTargetId: target.id, port });
  });
}
export async function browserTabs(cfg) {
  return withPage(cfg, 'browser_tabs', async (port, selected) => {
    const pages = await pageTargets(port);
    const tabs = [];
    for (const [index, page] of pages.slice(0, 24).entries()) {
      const active = await evaluate(page, '({visible:document.visibilityState==="visible",focused:document.hasFocus()})').catch(() => null);
      tabs.push({ index, id: page.id, title: page.title, url: page.url, selected: page.id === selected.id, active: active?.focused ?? null, visible: active?.visible ?? null });
    }
    return { ok: true, state: 'completed', verified: true, selectedTargetId: selected.id, tabs };
  });
}
export async function browserSelectTab(cfg, index) {
  return withPage(cfg, 'browser_select_tab', async (port, beforeTarget) => {
    const target = (await pageTargets(port))[validIndex(index)];
    if (!target) throw failure('PC_BROWSER_TAB_NOT_FOUND');
    const before = await observe(beforeTarget);
    invalidate(port);
    await activateTarget(port, target.id);
    const after = await waitState(target, () => true);
    if (await evaluate(target, 'document.visibilityState') !== 'visible') throw failure('PC_BROWSER_TAB_ACTIVATION_UNVERIFIED', after);
    return completed('browser_select_tab', before, after, { selected: true, index, id: target.id, url: after.url, title: after.title });
  });
}
const nodesExpression = `[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"]')].filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&r.width>0&&r.height>0})`;
// The registry holds actual elements, never a re-evaluated ordinal query at action time.
async function snapshot(port, target) {
  const token = `${Date.now()}-${Math.random()}`;
  const start = nextIndex; nextIndex += 200;
  const data = await evaluate(target, `(() => {
    const nodes=${nodesExpression}.slice(0,160);
    const label=e=>String(e.innerText||e.getAttribute('aria-label')||e.labels?.[0]?.innerText||e.getAttribute('title')||e.getAttribute('placeholder')||'').replace(/\\s+/g,' ').trim().slice(0,240);
    const signature=e=>JSON.stringify([e.tagName,e.getAttribute('type'),label(e),e.getAttribute('href'),e.disabled,e.readOnly,e.getAttribute('role')]);
    globalThis.__sextaSnapshot={token:${JSON.stringify(token)},nodes,signature,signatures:nodes.map(signature),start:${start}};
    return {title:document.title,url:location.href,text:(document.body?.innerText||'').slice(0,14000),elements:nodes.map((e,i)=>({index:${start}+i,tag:e.tagName.toLowerCase(),type:e.getAttribute('type')||'',role:e.getAttribute('role')||'',text:e.type==='password'?'[password]':label(e),name:e.name||'',id:e.id||'',disabled:!!e.disabled,href:e.tagName==='A'?e.href:''}))};
  })()`);
  snapshots.set(port, { token, targetId: target.id, start });
  return { ...data, tabId: target.id, snapshotId: token, ok: true, state: 'completed', verified: true };
}
export async function browserSnapshot(cfg) {
  return withPage(cfg, 'browser_snapshot', async (port, target) => { await waitState(target, () => true); return snapshot(port, target); });
}
function elementExpression(port, target, index) {
  validIndex(index);
  const saved = snapshots.get(port);
  if (!saved || saved.targetId !== target.id) throw failure('PC_BROWSER_SNAPSHOT_REQUIRED');
  return `const s=globalThis.__sextaSnapshot; if(!s||s.token!==${JSON.stringify(saved.token)}) throw Error('STALE_SNAPSHOT');
    const n=${index}-s.start,el=s.nodes[n]; if(!el||!el.isConnected||s.signature(el)!==s.signatures[n]) throw Error('STALE_ELEMENT');`;
}
async function elementAction(cfg, action, index, text) {
  return withPage(cfg, action, async (port, target) => {
    const ref = elementExpression(port, target, index);
    const before = await observe(target);
    const result = await evaluate(target, `(() => { ${ref}
      if(el.disabled||el.getAttribute('aria-disabled')==='true') return {error:'PC_BROWSER_ELEMENT_DISABLED'};
      if(el.type==='password') return {error:'PC_BROWSER_PASSWORD_FIELD_BLOCKED'};
      const label=[el.innerText,el.getAttribute('aria-label'),el.title,el.name,el.id,el.getAttribute('href'),el.getAttribute('formaction')].filter(Boolean).join(' ');
      if(${SENSITIVE}.test(label)) return {error:'PC_BROWSER_SENSITIVE_CONTROL_BLOCKED'};
      if(${JSON.stringify(action)}==='browser_click') {
        if(!label.trim()) return {error:'PC_BROWSER_UNLABELED_CONTROL_BLOCKED'};
        if((el.form&&(el.type==='submit'||el.type==='image'||(el.tagName==='BUTTON'&&el.type!=='button')))||el.hasAttribute('download')) return {error:'PC_BROWSER_SENSITIVE_CONTROL_BLOCKED'};
        if(el.tagName==='A'&&!/^https?:$/.test(new URL(el.href).protocol)) return {error:'PC_BROWSER_URL_BLOCKED'};
        el.scrollIntoView({block:'center'}); el.click(); return {acted:true};
      }
      if(el.readOnly||(!el.isContentEditable&&!['INPUT','TEXTAREA'].includes(el.tagName))||(el.tagName==='INPUT'&&!['text','search','email','url','tel','number'].includes(el.type))) return {error:'PC_BROWSER_NOT_EDITABLE'};
      el.focus(); const value=${JSON.stringify(String(text ?? '').slice(0,4000))};
      if(el.isContentEditable) el.textContent=value;
      else Object.getOwnPropertyDescriptor(el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(el,value);
      el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));
      return {acted:true};
    })()`);
    if (result?.error) throw failure(result.error, before);
    invalidate(port);
    let after;
    if (action === 'browser_type') {
      after = await waitState(target, () => true);
      const matches = await evaluate(target, `(() => { ${ref} return (el.isContentEditable?el.textContent:el.value)===${JSON.stringify(String(text ?? '').slice(0,4000))}; })()`);
      if (!matches) throw failure('PC_BROWSER_INPUT_VERIFICATION_FAILED', after);
    } else {
      after = await waitState(target, s => JSON.stringify(s) !== JSON.stringify(before));
    }
    const current = await snapshot(port, target);
    return completed(action, before, after, { index, ...(action === 'browser_type' ? { typed: true, length: String(text ?? '').slice(0,4000).length } : { clicked: true }), snapshot: current });
  });
}
export async function browserClick(cfg, index) { return elementAction(cfg, 'browser_click', index); }
export async function browserType(cfg, index, text) { return elementAction(cfg, 'browser_type', index, text); }
async function navigateHistory(cfg, action, delta) {
  return withPage(cfg, action, async (port, target) => {
    const before = await observe(target);
    const history = await cdpCall(target, 'Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + delta];
    if (!entry) throw failure('PC_BROWSER_HISTORY_BOUNDARY', before);
    invalidate(port);
    await cdpCall(target, 'Page.navigateToHistoryEntry', { entryId: entry.id });
    const after = await waitState(target, s => s.url === entry.url);
    const checked = await cdpCall(target, 'Page.getNavigationHistory');
    if (checked.entries[checked.currentIndex]?.id !== entry.id) throw failure('PC_BROWSER_HISTORY_UNVERIFIED', after);
    return completed(action, before, after, { [delta < 0 ? 'back' : 'forward']: true });
  });
}
export async function browserBack(cfg) { return navigateHistory(cfg, 'browser_back', -1); }
export async function browserForward(cfg) { return navigateHistory(cfg, 'browser_forward', 1); }
export async function browserReload(cfg) {
  return withPage(cfg, 'browser_reload', async (port, target) => {
    const before = await observe(target); invalidate(port);
    await cdpCall(target, 'Page.reload', { ignoreCache: false });
    const after = await waitState(target, s => s.documentId !== before.documentId);
    return completed('browser_reload', before, after, { reloaded: true });
  });
}
export function browserStatus(cfg = {}) {
  const port = browserPort(cfg);
  return { configured: true, port, profile: browserProfile(cfg), processStarted: Boolean(browserProcess), selectedTargetId: selectedTargetId || readPersistedSelection(port) || null };
}
