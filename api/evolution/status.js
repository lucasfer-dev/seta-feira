import { isOwner, send } from '../../lib/core.mjs';
import { evolutionConnectionState, evolutionStatus } from '../../lib/evolution.mjs';
export default async function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{ const basic=evolutionStatus(); const connection=basic.configured?await evolutionConnectionState():{configured:false,connected:false}; send(res,200,{...basic,...connection}); }
  catch(error){ send(res,200,{...evolutionStatus(),connected:false,state:'error',error:error.message}); }
}
