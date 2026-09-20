import { sextaError } from './errors.mjs';
import { events } from './event-bus.mjs';

const registry = new Map();

function assertDescriptor(descriptor) {
  if (!descriptor?.name) throw sextaError('CAPABILITY_NAME_REQUIRED', 'Capability sem nome.');
  if (typeof descriptor.execute !== 'function') throw sextaError('CAPABILITY_EXECUTOR_REQUIRED', `Capability ${descriptor.name} sem executor.`);
}

export function registerCapability(descriptor) {
  assertDescriptor(descriptor);
  const normalized = Object.freeze({
    description: '',
    risk: 'low',
    deviceRequirements: [],
    executionTarget: 'local',
    verificationMethod: 'executor',
    inputSchema: null,
    outputSchema: null,
    ...descriptor
  });
  registry.set(normalized.name, normalized);
  events.emitEvent('capability.registered', {
    name: normalized.name,
    risk: normalized.risk,
    executionTarget: normalized.executionTarget
  });
  return normalized;
}

export function unregisterCapability(name) {
  return registry.delete(String(name));
}

export function getCapability(name) {
  return registry.get(String(name)) || null;
}

export function listCapabilities() {
  return [...registry.values()].map(item => ({
    name: item.name,
    description: item.description,
    risk: item.risk,
    deviceRequirements: item.deviceRequirements,
    executionTarget: item.executionTarget,
    verificationMethod: item.verificationMethod
  }));
}

export async function executeCapability(name, input, context = {}) {
  const capability = getCapability(name);
  if (!capability) throw sextaError('CAPABILITY_UNAVAILABLE', `Capability indisponível: ${name}`, { recoverable: true });

  if (capability.inputSchema?.parse) input = capability.inputSchema.parse(input);
  events.emitEvent('capability.requested', { name, input, context });

  const output = await capability.execute(input, context);
  const parsed = capability.outputSchema?.parse ? capability.outputSchema.parse(output) : output;

  if (typeof capability.verify === 'function') {
    const verified = await capability.verify(parsed, input, context);
    if (!verified) throw sextaError('ACTION_NOT_VERIFIED', `Ação não verificada: ${name}`, { recoverable: true, retryable: true });
  }

  return parsed;
}

export function resetCapabilities() {
  registry.clear();
}
