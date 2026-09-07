import { isOwner, parseJson, send } from '../lib/core.mjs';
import { deleteRoutine, listRoutines, saveRoutine } from '../lib/routines.mjs';
export default async function handler(req,res){
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  try{
    if(req.method==='GET') return send(res,200,{ok:true,routines:await listRoutines()});
    const body=await parseJson(req);
    if(req.method==='POST') return send(res,200,{ok:true,routine:await saveRoutine(body)});
    if(req.method==='DELETE') return send(res,200,{ok:true,deleted:await deleteRoutine(body.id||body.name)});
    return send(res,405,{error:'method_not_allowed'});
  }catch(error){return send(res,400,{error:'routine_failed',message:error.message});}
}
