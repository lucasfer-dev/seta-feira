import crypto from 'node:crypto';
import { isOwner, send } from '../../lib/core.mjs';
import { runMonitor } from '../../lib/monitor.mjs';

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isCron(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(req.headers?.authorization || '');
  return Boolean(secret) && safeEqual(authorization, `Bearer ${secret}`);
}

export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)) return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req) && !isCron(req)) return send(res,401,{error:'unauthorized'});
  try{ send(res,200,{ok:true,...await runMonitor()}); }
  catch(error){send(res,500,{error:'monitor_failed',message:error.message});}
}
