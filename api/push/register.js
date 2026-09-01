import { isOwner, parseJson, registerPushToken, send } from '../../lib/core.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{ send(res,200,await registerPushToken(await parseJson(req))); }
  catch(error){send(res,500,{error:'push_register_failed',message:error.message});}
}
