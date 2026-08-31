import { isOwner, parseJson, send } from '../../lib/core.mjs';
import { executeWorkspaceAction, formatWorkspaceResult } from '../../lib/google.mjs';
export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const body=await parseJson(req); const action=String(body.action||''); const args=body.args&&typeof body.args==='object'?body.args:{};
  try{const result=await executeWorkspaceAction(action,args);return send(res,200,{result,reply:formatWorkspaceResult({action,args},result)})}
  catch(e){return send(res,400,{error:e.message})}
}
