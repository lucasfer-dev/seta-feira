import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function defaultAuditPath() {
  const root = process.platform === 'win32' ? (process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(),'AppData','Local')) : path.join(os.homedir(),'.local','state');
  return path.join(root,'SEXTA','agent-audit.log');
}
const AUDIT_PATH = path.resolve(process.env.SEXTA_AGENT_AUDIT || defaultAuditPath());
const MAX_BYTES = Math.max(256*1024,Number(process.env.SEXTA_AGENT_AUDIT_MAX_BYTES || 2*1024*1024));
const BACKUPS = Math.max(1,Math.min(8,Number(process.env.SEXTA_AGENT_AUDIT_BACKUPS || 3)));
const SECRET_KEYS = /token|password|senha|secret|authorization|imagebase64|cookie|api[-_]?key|text/i;
let lastFailure = '';
function scrub(value, depth = 0, seen = new WeakSet()) {
  if (depth > 4) return '[depth-limit]';
  if (!value || typeof value !== 'object') { const text=String(value??''); return text.length>240?`${text.slice(0,240)}…`:value; }
  if (seen.has(value)) return '[circular]'; seen.add(value);
  if (Array.isArray(value)) return value.slice(0,16).map(item=>scrub(item,depth+1,seen));
  const out={}; for (const [key,item] of Object.entries(value)) out[key]=SECRET_KEYS.test(key)?'[redacted]':scrub(item,depth+1,seen); return out;
}
function rotateIfNeeded() {
  try {
    if (!fs.existsSync(AUDIT_PATH) || fs.statSync(AUDIT_PATH).size < MAX_BYTES) return;
    for (let index=BACKUPS; index>=1; index-=1) { const from=index===1?AUDIT_PATH:`${AUDIT_PATH}.${index-1}`; const to=`${AUDIT_PATH}.${index}`; if(!fs.existsSync(from))continue; if(index===BACKUPS&&fs.existsSync(to))fs.rmSync(to,{force:true}); fs.renameSync(from,to); }
  } catch (error) { lastFailure=`rotate:${String(error?.message||error).slice(0,300)}`; console.error('[SEXTA Audit]',lastFailure); }
}
export function audit(entry = {}) {
  try { fs.mkdirSync(path.dirname(AUDIT_PATH),{recursive:true}); rotateIfNeeded(); const row={at:new Date().toISOString(),pid:process.pid,commandId:String(entry.commandId||''),action:String(entry.action||''),status:String(entry.status||''),ok:entry.ok===true,details:scrub(entry.details||{})}; fs.appendFileSync(AUDIT_PATH,`${JSON.stringify(row)}\n`,'utf8'); lastFailure=''; return true; }
  catch (error) { lastFailure=String(error?.message||error).slice(0,300); console.error('[SEXTA Audit] write failed:',lastFailure); return false; }
}
export function auditPath(){return AUDIT_PATH;}
export function auditHealth(){ try{fs.mkdirSync(path.dirname(AUDIT_PATH),{recursive:true});fs.closeSync(fs.openSync(AUDIT_PATH,'a'));return{ok:true,path:AUDIT_PATH,maxBytes:MAX_BYTES,backups:BACKUPS,lastFailure};}catch(error){return{ok:false,path:AUDIT_PATH,maxBytes:MAX_BYTES,backups:BACKUPS,lastFailure:String(error?.message||error).slice(0,300)};} }
