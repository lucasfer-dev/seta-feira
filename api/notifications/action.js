import { isOwner, parseJson, send, updateNotification } from '../../lib/core.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const body=await parseJson(req);
  try{ await updateNotification(String(body.id||''),{status:String(body.status||'read')}); send(res,200,{ok:true}); }
  catch(error){send(res,500,{error:'notification_update_failed',message:error.message});}
}
