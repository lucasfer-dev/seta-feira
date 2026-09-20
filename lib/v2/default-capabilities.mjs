import { registerCapability, getCapability } from './capability-registry.mjs';
import { executeTool } from '../tool-core.mjs';

let bootstrapped = false;

function registerIfMissing(descriptor) {
  if (!getCapability(descriptor.name)) registerCapability(descriptor);
}

export function bootstrapDefaultCapabilities() {
  if (bootstrapped) return;
  bootstrapped = true;

  registerIfMissing({
    name: 'computer.openApp',
    description: 'Abre um aplicativo no Home Hub Windows.',
    risk: 'low',
    deviceRequirements: ['windows'],
    executionTarget: 'home-pc',
    verificationMethod: 'command-result',
    execute: async ({ app }, context = {}) => executeTool('pc_open_app', { app }, {
      deviceId: context.deviceId || '',
      userText: context.userText || `abre ${app}`,
      enforceExplicit: true
    })
  });

  registerIfMissing({
    name: 'computer.closeWindow',
    description: 'Fecha a janela ativa no Home Hub Windows.',
    risk: 'medium',
    deviceRequirements: ['windows'],
    executionTarget: 'home-pc',
    verificationMethod: 'command-result',
    execute: async (_input, context = {}) => executeTool('pc_window_close', {}, {
      deviceId: context.deviceId || '',
      userText: context.userText || 'fecha esta janela',
      enforceExplicit: true
    })
  });

  registerIfMissing({
    name: 'computer.minimizeWindow',
    description: 'Minimiza a janela ativa no Home Hub Windows.',
    risk: 'low',
    deviceRequirements: ['windows'],
    executionTarget: 'home-pc',
    verificationMethod: 'command-result',
    execute: async (_input, context = {}) => executeTool('pc_window_state', { state: 'minimize' }, {
      deviceId: context.deviceId || '',
      userText: context.userText || 'minimiza esta janela',
      enforceExplicit: true
    })
  });

  registerIfMissing({
    name: 'computer.screenshot',
    description: 'Observa a tela atual do Home Hub.',
    risk: 'low',
    deviceRequirements: ['screen'],
    executionTarget: 'home-pc',
    verificationMethod: 'executor',
    execute: async (_input, context = {}) => executeTool('pc_screen_analyze', { prompt: 'Descreva objetivamente o estado atual da tela.' }, {
      deviceId: context.deviceId || '',
      userText: context.userText || 'tira um screenshot',
      enforceExplicit: true
    })
  });
}
