import { isOwner, parseJson, send } from '../../lib/core.mjs';
import { executeWorkspaceAction, formatWorkspaceResult } from '../../lib/google.mjs';
import { executeTool } from '../../lib/tool-bus.mjs';

function sensitiveTool(action, args) {
  if (action === 'gmail.send' || action === 'gmail.send-smart') {
    return { name: 'google_send_email', args: { recipient: args.recipient || args.to, subject: args.subject, body: args.body } };
  }
  const names = {
    'calendar.create': 'google_calendar_create',
    'docs.create': 'google_docs_create',
    'sheets.create': 'google_sheets_create',
    'tasks.create': 'google_task_create'
  };
  return names[action] ? { name: names[action], args } : null;
}

export default async function handler(req,res){
  if(req.method!=='POST') return send(res,405,{error:'method_not_allowed'});
  if(!isOwner(req)) return send(res,401,{error:'unauthorized'});
  const body=await parseJson(req); const action=String(body.action||''); const args=body.args&&typeof body.args==='object'?body.args:{};
  try{
    const sensitive=sensitiveTool(action,args);
    if(sensitive){
      const confirmation=await executeTool(sensitive.name,sensitive.args,{deviceId:String(body.deviceId||'browser').slice(0,120)});
      return send(res,200,{confirmation,reply:confirmation.message});
    }
    const result=await executeWorkspaceAction(action,args);
    return send(res,200,{result,reply:formatWorkspaceResult({action,args},result)});
  }
  catch(e){return send(res,400,{error:e.message})}
}
