import { addEvent, isOwner, parseJson, send } from '../../lib/core.mjs';
import { sendWhatsAppText } from '../../lib/evolution.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const body=await parseJson(req);
  try{
    const result=await sendWhatsAppText({recipient:body.recipient,text:body.text});
    await addEvent({level:'success',title:'WhatsApp enviado',body:`Mensagem enviada para ${result.to.label}.`,metadata:{source:'whatsapp',recipient:result.to}});
    send(res,200,{ok:true,to:result.to,result:result.result});
  }catch(error){
    if(error.message==='WHATSAPP_RECIPIENT_AMBIGUOUS') return send(res,409,{error:'recipient_ambiguous',message:'Encontrei mais de um telefone para esse contato.',candidates:error.candidates||[]});
    send(res,500,{error:'whatsapp_send_failed',message:error.message});
  }
}
