import { getNotifications, isOwner, send } from '../../lib/core.mjs';
export default async function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const u=new URL(req.url,'http://localhost');
  try{ send(res,200,{notifications:await getNotifications(Number(u.searchParams.get('limit')||40),u.searchParams.get('status')||'')}); }
  catch(error){send(res,500,{error:'notifications_failed',message:error.message});}
}
