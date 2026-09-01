import { isOwner, parseJson, saveMessage, send } from '../lib/core.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const body=await parseJson(req); const content=String(body.content||'').trim();
  if(!content) return send(res,400,{error:'content_required'});
  const conversationId=String(body.conversationId||'main').slice(0,100);
  await saveMessage({conversation_id:conversationId,role:'assistant',content:content.slice(0,12000),device_id:'chatgpt-handoff'});
  return send(res,200,{ok:true});
}
