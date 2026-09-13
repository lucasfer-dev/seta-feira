const ROUTES = Object.freeze({
  windows: Object.freeze({ open_app:'pc_open_app', open_url:'pc_open_url', list_windows:'pc_window_list', focus_window:'pc_window_focus', screen:'pc_screen_analyze', click:'pc_ui_click_text', type:'pc_ui_type_text', action:'pc_ui_action', scroll:'pc_ui_scroll', hotkey:'pc_ui_hotkey' }),
  browser: Object.freeze({ open:'pc_browser_open', tabs:'pc_browser_tabs', snapshot:'pc_browser_snapshot', click:'pc_browser_click', type:'pc_browser_type', back:'pc_browser_back', forward:'pc_browser_forward', reload:'pc_browser_reload' }),
  memory: Object.freeze({ list:'memory_list' }),
  codex: Object.freeze({ task:'pc_codex_task', status:'pc_codex_status' }),
  google: Object.freeze({ calendar:'google_calendar_list', drive:'google_drive_search', unread_email:'google_unread_email' }),
  whatsapp: Object.freeze({ send:'whatsapp_send_message' })
});

export const CAPABILITY_DISPATCH_DECLARATION = Object.freeze({
  name:'capability_dispatch',
  description:'Roteia uma capacidade menos comum para uma ferramenta allowlisted da SEXTA sem expor dezenas de schemas no canal de voz. Não é shell genérico.',
  parameters:{ type:'object', properties:{ capability:{type:'string',enum:Object.keys(ROUTES)}, action:{type:'string'}, args:{type:'object'} }, required:['capability','action'] }
});

export function resolveCapabilityRoute(capability = '', action = '') {
  const family = String(capability || '').trim().toLowerCase();
  const operation = String(action || '').trim().toLowerCase();
  const tool = ROUTES[family]?.[operation] || '';
  return tool ? { capability:family, action:operation, tool } : null;
}

export async function executeCapabilityDispatch(args = {}, { execute, options = {} } = {}) {
  if (process.env.SEXTA_CAPABILITY_ROUTER === '0') throw new Error('CAPABILITY_ROUTER_DISABLED');
  if (typeof execute !== 'function') throw new Error('CAPABILITY_ROUTER_EXECUTOR_REQUIRED');
  const route = resolveCapabilityRoute(args.capability, args.action);
  if (!route) throw new Error('CAPABILITY_ROUTE_NOT_ALLOWED');
  const routedArgs = args.args && typeof args.args === 'object' ? args.args : {};
  const result = await execute(route.tool, routedArgs, { ...options, routedFrom:'capability_dispatch' });
  return result && typeof result === 'object' ? { ...result, route:{ capability:route.capability, action:route.action, tool:route.tool } } : result;
}
