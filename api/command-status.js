import { getCommand, isOwner, send } from '../lib/core.mjs';
export default async function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const u=new URL(req.url,'http://localhost'); const id=u.searchParams.get('id')||'';
  const command=await getCommand(id); if(!command) return send(res,404,{error:'not_found'});
  return send(res,200,{command});
}
