import { getDevices } from './core.mjs';
import { queueAndroidAction } from './android-actions.mjs';

const objectSchema = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const stringProp = description => ({ type: 'string', description });

export const ANDROID_HANDS_TOOL_DECLARATIONS = [
  {
    name: 'android_ui_snapshot',
    description: 'Lê sob demanda a árvore estrutural da tela Android atual pela Acessibilidade (textos, descrições, tipos e estados), sem screenshot. Use como fallback de visão apenas quando uma tarefa explícita no Android não puder ser resolvida por uma ferramenta dedicada.',
    parameters: objectSchema({})
  },
  {
    name: 'android_ui_tap_text',
    description: 'Toca um controle Android não sensível encontrado pelo texto/descrição visível. Use android_ui_snapshot antes. A camada nativa bloqueia controles genéricos de enviar, pagar, comprar, confirmar, excluir, publicar ou transferir; ações finais sensíveis devem usar ferramentas dedicadas.',
    parameters: objectSchema({ text: stringProp('Texto ou descrição exata/curta do controle visível a tocar.') }, ['text'])
  },
  {
    name: 'android_ui_scroll',
    description: 'Rola a área rolável principal da tela Android para cima ou para baixo. Use somente dentro de uma tarefa explícita do usuário.',
    parameters: objectSchema({ direction: { type: 'string', enum: ['up', 'down'], description: 'Direção da rolagem.' } }, ['direction'])
  },
  {
    name: 'android_ui_back',
    description: 'Executa Voltar no Android durante uma navegação explícita.',
    parameters: objectSchema({})
  },
  {
    name: 'android_ui_home',
    description: 'Retorna à tela inicial do Android durante uma navegação explícita.',
    parameters: objectSchema({})
  }
];

const ACTION_MAP = {
  android_ui_snapshot: () => ({ action: 'ui_snapshot', payload: {} }),
  android_ui_tap_text: args => ({ action: 'ui_tap_text', payload: { text: String(args?.text || '').trim().slice(0, 160) } }),
  android_ui_scroll: args => ({ action: 'ui_scroll', payload: { direction: args?.direction === 'up' ? 'up' : 'down' } }),
  android_ui_back: () => ({ action: 'ui_back', payload: {} }),
  android_ui_home: () => ({ action: 'ui_home', payload: {} })
};

function isNativeAndroid(device = {}) {
  const caps = new Set(Array.isArray(device.capabilities) ? device.capabilities : []);
  const context = device.context && typeof device.context === 'object' ? device.context : {};
  return Boolean(device.online && (
    context.nativeAndroid === true
    || String(context.platform || '').toLowerCase() === 'android'
    || caps.has('ui_snapshot')
    || caps.has('device_info')
  ));
}

async function androidTarget(originDeviceId = '') {
  const devices = await getDevices();
  const origin = originDeviceId ? devices.find(device => device.device_id === originDeviceId) : null;
  if (isNativeAndroid(origin)) return origin.device_id;
  return devices.find(isNativeAndroid)?.device_id || '';
}

export function isAndroidHandsTool(name = '') {
  return Object.hasOwn(ACTION_MAP, String(name || ''));
}

export async function executeAndroidHandsTool(name, args = {}, { preferLocalAndroid = false, deviceId = '' } = {}) {
  const factory = ACTION_MAP[name];
  if (!factory) throw new Error('ANDROID_HANDS_TOOL_NOT_ALLOWED');
  const clientAction = factory(args || {});
  if (name === 'android_ui_tap_text' && !clientAction.payload.text) throw new Error('ANDROID_UI_TEXT_REQUIRED');

  if (preferLocalAndroid) {
    return {
      ok: true,
      handled: true,
      scope: 'android-hands-local',
      state: 'ready_for_local_execution',
      clientAction
    };
  }

  const target = await androidTarget(deviceId);
  if (!target) throw new Error('NO_ANDROID_AGENT_ONLINE');
  const queued = await queueAndroidAction(clientAction.action, clientAction.payload, target);
  return {
    ok: true,
    handled: true,
    scope: 'android-hands',
    state: 'accepted',
    queued: true,
    commandId: queued.id,
    targetDeviceId: queued.target_device_id,
    action: clientAction.action,
    message: name === 'android_ui_snapshot'
      ? 'Leitura estrutural da tela solicitada ao Android.'
      : 'Passo de navegação enviado ao Android; aguardando confirmação.'
  };
}
