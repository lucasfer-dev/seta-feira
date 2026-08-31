import { isOwner, send } from '../../lib/core.mjs';
import { runMonitor } from '../../lib/monitor.mjs';
export default async function handler(req,res){
  if(!['GET','POST'].includes(req.method)) return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{ send(res,200,{ok:true,...await runMonitor()}); }
  catch(error){send(res,500,{error:'monitor_failed',message:error.message});}
}
