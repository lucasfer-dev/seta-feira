import { isOwner, parseJson, send } from '../../lib/core.mjs';
import { executeTool } from '../../lib/tool-bus.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const body=await parseJson(req);
  try{
    const confirmation=await executeTool('whatsapp_send_message',{recipient:body.recipient,text:body.text},{deviceId:String(body.deviceId||'browser').slice(0,120)});
    send(res,200,{ok:true,confirmation,reply:confirmation.message});
  }catch(error){
    if(error.message==='WHATSAPP_RECIPIENT_AMBIGUOUS') return send(res,409,{error:'recipient_ambiguous',message:'Encontrei mais de um telefone para esse contato.',candidates:error.candidates||[]});
    send(res,500,{error:'whatsapp_send_failed',message:error.message});
  }
}
