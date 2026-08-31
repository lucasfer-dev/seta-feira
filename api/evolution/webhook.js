import { addEvent, parseJson, saveNotification, send } from '../../lib/core.mjs';
import { parseEvolutionIncoming, verifyEvolutionWebhook } from '../../lib/evolution.mjs';
import { classifyPriority } from '../../lib/priority.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!verifyEvolutionWebhook(req)) return send(res,401,{error:'invalid_webhook_secret'});
  try{
    const payload=await parseJson(req); const incoming=parseEvolutionIncoming(payload);
    if(!incoming) return send(res,200,{ok:true,ignored:true});
    const p=classifyPriority({source:'whatsapp',sender:incoming.sender,title:'WhatsApp',body:incoming.text,metadata:{isGroup:incoming.isGroup,fromMe:incoming.fromMe}});
    const notification=await saveNotification({source:'whatsapp',sourceId:incoming.sourceId,sender:incoming.sender,title:incoming.isGroup?`WhatsApp • grupo`:`WhatsApp • ${incoming.sender}`,body:incoming.text,priority:p.score,reason:p.reason,metadata:{...incoming,level:p.level}});
    if(notification.created && p.score>=62) await addEvent({level:p.score>=82?'warning':'info',title:`Mensagem ${p.score>=82?'urgente':'importante'} no WhatsApp`,body:`${incoming.sender}: ${incoming.text.slice(0,220)}`,metadata:{source:'whatsapp',notificationId:notification.id,priority:p.score}});
    send(res,200,{ok:true,notification:{id:notification.id,created:notification.created,priority:p.score,level:p.level}});
  }catch(error){ console.error(error); send(res,500,{error:'webhook_failed',message:error.message}); }
}
