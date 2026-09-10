export const PC_COMMAND_PROTOCOL_VERSION = 3;
export const PC_COMMAND_TRANSPORT_ACTION = 'git_status';

const DESKTOP_ACTIONS = new Set([
  'window_list', 'window_focus', 'window_close', 'window_state', 'window_move_resize',
  'ui_tree', 'ui_click_text', 'ui_type_text', 'ui_action', 'ui_scroll', 'ui_hotkey', 'screen_analyze', 'screen_click_point',
  'browser_open', 'browser_tabs', 'browser_select_tab', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_back', 'browser_forward', 'browser_reload',
  'hardware_status', 'agent_control'
]);

export function isDesktopProtocolAction(action) {
  return DESKTOP_ACTIONS.has(String(action || ''));
}

export function encodeDesktopCommand(action, payload = {}) {
  const name = String(action || '');
  if (!isDesktopProtocolAction(name)) throw new Error('PC_COMMAND_PROTOCOL_ACTION_BLOCKED');
  return {
    action: PC_COMMAND_TRANSPORT_ACTION,
    payload: {
      _sextaDesktopProtocol: PC_COMMAND_PROTOCOL_VERSION,
      _sextaDesktopAction: name,
      data: payload && typeof payload === 'object' ? payload : {}
    }
  };
}

export function decodeDesktopCommand(action, payload = {}) {
  if (String(action || '') !== PC_COMMAND_TRANSPORT_ACTION) return null;
  if (Number(payload?._sextaDesktopProtocol) !== PC_COMMAND_PROTOCOL_VERSION) return null;
  const desktopAction = String(payload?._sextaDesktopAction || '');
  if (!isDesktopProtocolAction(desktopAction)) throw new Error('PC_COMMAND_PROTOCOL_ACTION_BLOCKED');
  return {
    action: desktopAction,
    payload: payload?.data && typeof payload.data === 'object' ? payload.data : {}
  };
}

export function desktopProtocolActions() {
  return [...DESKTOP_ACTIONS];
}
