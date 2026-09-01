import { isOwner, send } from '../../lib/core.mjs';
import { createGoogleAuthUrl } from '../../lib/google.mjs';
export default async function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{return send(res,200,{url:createGoogleAuthUrl()})}catch(e){return send(res,400,{error:e.message})}
}
