import { isOwner, send } from '../../lib/core.mjs';
import { configureEvolutionWebhook } from '../../lib/evolution.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{ send(res,200,{ok:true,result:await configureEvolutionWebhook()}); }
  catch(error){ send(res,500,{error:'evolution_webhook_failed',message:error.message}); }
}
