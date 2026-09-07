import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browserProcess = null;

function browserPort(cfg = {}) {
  return Math.max(1025, Math.min(65534, Number(cfg.browser?.debugPort) || 9223));
}

function browserProfile(cfg = {}) {
  return path.resolve(String(cfg.browser?.profileDir || path.join(os.homedir(), '.sexta-browser-profile')));
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
  if (process.platform !== 'win32') throw new Error('PC_BROWSER_WINDOWS_ONLY');
  const port = browserPort(cfg);
  if (await debugReady(port)) return port;

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
  browserProcess.unref();

  for (let i = 0; i < 30; i += 1) {
    if (await debugReady(port)) return port;
    await sleep(180);
  }
  throw new Error('PC_BROWSER_DEBUG_NOT_READY');
}

async function pageTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`PC_BROWSER_TARGETS_${response.status}`);
  const targets = await response.json();
  const pages = (Array.isArray(targets) ? targets : []).filter(item => item?.type === 'page' && item?.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('PC_BROWSER_NO_PAGE');
  return pages.find(item => !String(item.url || '').startsWith('devtools://')) || pages[0];
}

async function cdpCall(port, method, params = {}) {
  const target = await pageTarget(port);
  const Ws = globalThis.WebSocket;
  if (!Ws) throw new Error('PC_BROWSER_WEBSOCKET_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    const ws = new Ws(target.webSocketDebuggerUrl);
    const id = Math.floor(Math.random() * 1_000_000) + 1;
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error(`PC_BROWSER_CDP_TIMEOUT:${method}`));
    }, 6000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ id, method, params })));
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('PC_BROWSER_CDP_SOCKET_FAILED'));
    });
    ws.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(String(event.data || '')); } catch { return; }
      if (message.id !== id) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (message.error) reject(new Error(`PC_BROWSER_CDP_${message.error.code}:${message.error.message}`));
      else resolve(message.result || {});
    });
  });
}

const interactiveExpression = `(() => {
  const visible = el => {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || 1) > 0 && r.width > 0 && r.height > 0;
  };
  const nodes = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"]')].filter(visible).slice(0, 160);
  return nodes;
})()`;

function parseEval(result) {
  const value = result?.result?.value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

async function evaluate(port, expression, returnByValue = true) {
  return cdpCall(port, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue, userGesture: true });
}

const SENSITIVE = /\b(?:send|submit|pay|purchase|buy|checkout|confirm|delete|remove|publish|post|transfer|wire|enviar|pagar|comprar|finalizar|confirmar|excluir|remover|publicar|transferir|assinar|subscribe)\b/i;

export async function browserOpen(cfg, rawUrl) {
  const url = new URL(String(rawUrl || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PC_BROWSER_URL_BLOCKED');
  const port = await ensureBrowser(cfg);
  await cdpCall(port, 'Page.enable').catch(() => {});
  const result = await cdpCall(port, 'Page.navigate', { url: url.toString() });
  await sleep(500);
  return { opened: url.toString(), frameId: result.frameId || null, port, profile: browserProfile(cfg) };
}

export async function browserSnapshot(cfg) {
  const port = await ensureBrowser(cfg);
  const expression = `(() => {
    const visible = el => { const s=getComputedStyle(el), r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)>0&&r.width>0&&r.height>0; };
    const nodes=[...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[role="tab"],[contenteditable="true"]')].filter(visible).slice(0,140);
    const elements=nodes.map((el,index)=>({
      index, tag:el.tagName.toLowerCase(), role:el.getAttribute('role')||'', type:el.getAttribute('type')||'',
      text:String(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('placeholder')||'').replace(/\\s+/g,' ').trim().slice(0,240),
      name:String(el.getAttribute('name')||'').slice(0,120), id:String(el.id||'').slice(0,120), disabled:Boolean(el.disabled),
      href:el.tagName==='A'?String(el.href||'').slice(0,500):''
    }));
    return JSON.stringify({title:document.title,url:location.href,text:String(document.body?.innerText||'').replace(/\\n{3,}/g,'\\n\\n').slice(0,14000),elements});
  })()`;
  const raw = await evaluate(port, expression);
  return parseEval(raw) || {};
}

async function browserElementMeta(port, index) {
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const expression = `(() => { const nodes=${interactiveExpression}; const el=nodes[${i}]; if(!el) return JSON.stringify({found:false}); return JSON.stringify({found:true,tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',text:String(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('placeholder')||'').replace(/\\s+/g,' ').trim().slice(0,300),disabled:Boolean(el.disabled)}); })()`;
  return parseEval(await evaluate(port, expression));
}

export async function browserClick(cfg, index) {
  const port = await ensureBrowser(cfg);
  const meta = await browserElementMeta(port, index);
  if (!meta?.found) throw new Error('PC_BROWSER_ELEMENT_NOT_FOUND');
  if (meta.disabled) throw new Error('PC_BROWSER_ELEMENT_DISABLED');
  if (SENSITIVE.test(String(meta.text || ''))) throw new Error('PC_BROWSER_SENSITIVE_CONTROL_BLOCKED');
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const expression = `(() => { const nodes=${interactiveExpression}; const el=nodes[${i}]; if(!el) return false; el.scrollIntoView({block:'center',inline:'center'}); el.focus(); el.click(); return true; })()`;
  const clicked = parseEval(await evaluate(port, expression));
  await sleep(220);
  return { clicked: Boolean(clicked), index: i, element: meta };
}

export async function browserType(cfg, index, text) {
  const port = await ensureBrowser(cfg);
  const meta = await browserElementMeta(port, index);
  if (!meta?.found) throw new Error('PC_BROWSER_ELEMENT_NOT_FOUND');
  if (meta.disabled) throw new Error('PC_BROWSER_ELEMENT_DISABLED');
  if (String(meta.type || '').toLowerCase() === 'password') throw new Error('PC_BROWSER_PASSWORD_FIELD_BLOCKED');
  const value = String(text || '').slice(0, 4000);
  const i = Math.max(0, Math.floor(Number(index) || 0));
  const encoded = JSON.stringify(value);
  const expression = `(() => { const nodes=${interactiveExpression}; const el=nodes[${i}]; if(!el) return false; el.scrollIntoView({block:'center'}); el.focus(); const value=${encoded}; if(el.isContentEditable){el.textContent=value;} else { const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; const d=Object.getOwnPropertyDescriptor(proto,'value'); if(d?.set) d.set.call(el,value); else el.value=value; } el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`;
  const typed = parseEval(await evaluate(port, expression));
  return { typed: Boolean(typed), index: i, length: value.length, element: meta };
}

export async function browserBack(cfg) {
  const port = await ensureBrowser(cfg);
  parseEval(await evaluate(port, `(() => { history.back(); return true; })()`));
  await sleep(350);
  return { back: true };
}

export function browserStatus(cfg = {}) {
  return { configured: true, port: browserPort(cfg), profile: browserProfile(cfg), processStarted: Boolean(browserProcess) };
}
