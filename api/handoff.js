import { isOwner, parseJson, send } from '../lib/core.mjs';
import { createHandoff, listHandoffs } from '../lib/handoff.mjs';
export default async function handler(req,res){
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{
    if(req.method==='GET') return send(res,200,{ok:true,handoffs:await listHandoffs(30)});
    if(req.method==='POST') return send(res,200,{ok:true,handoff:await createHandoff(await parseJson(req))});
    return send(res,405,{error:'method_not_allowed'});
  }catch(error){return send(res,400,{error:'handoff_failed',message:error.message});}
}
