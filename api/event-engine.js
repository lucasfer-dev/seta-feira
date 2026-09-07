import { isOwner, parseJson, send } from '../lib/core.mjs';
import { deleteEventRule, listEventRules, runEventEngine, saveEventRule } from '../lib/event-engine.mjs';
export default async function handler(req,res){
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{
    if(req.method==='GET') return send(res,200,{ok:true,rules:await listEventRules()});
    const body=await parseJson(req);
    if(req.method==='POST' && body.action==='run') return send(res,200,{ok:true,...await runEventEngine()});
    if(req.method==='POST') return send(res,200,{ok:true,rule:await saveEventRule(body)});
    if(req.method==='DELETE') return send(res,200,{ok:true,deleted:await deleteEventRule(body.id||body.name)});
    return send(res,405,{error:'method_not_allowed'});
  }catch(error){return send(res,400,{error:'event_engine_failed',message:error.message});}
}
