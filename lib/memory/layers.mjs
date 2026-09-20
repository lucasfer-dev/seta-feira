import { getMemories, getMessages, saveMemory, saveMessage } from '../core.mjs';
import { getWorldState } from '../v2/world-state.mjs';

const KINDS = Object.freeze({
  episodic: new Set(['event', 'episode']),
  semantic: new Set(['fact', 'preference', 'person', 'project', 'decision']),
  procedural: new Set(['procedure', 'workflow', 'routine'])
});

export function workingMemory() {
  return getWorldState();
}

export async function sessionMemory(conversationId = 'main', limit = 30) {
  return getMessages(conversationId, limit);
}

export async function appendSessionMemory({ conversationId = 'main', role, content, deviceId = '' }) {
  if (!role || !content) throw new Error('SESSION_MEMORY_INPUT_REQUIRED');
  return saveMessage({
    conversation_id: conversationId,
    role,
    content: String(content).slice(0, 12000),
    device_id: deviceId
  });
}

export async function rememberEpisodic(content, options = {}) {
  return saveMemory({
    content,
    kind: options.kind || 'episode',
    importance: options.importance ?? 0.72,
    source: options.source || 'episodic'
  });
}

export async function rememberSemantic(content, options = {}) {
  return saveMemory({
    content,
    kind: options.kind || 'fact',
    importance: options.importance ?? 0.78,
    source: options.source || 'semantic'
  });
}

export async function rememberProcedural(content, options = {}) {
  return saveMemory({
    content,
    kind: options.kind || 'procedure',
    importance: options.importance ?? 0.82,
    source: options.source || 'procedural'
  });
}

export async function readLongTermMemory({ layer = null, limit = 24 } = {}) {
  const memories = await getMemories(Math.max(1, Math.min(100, Number(limit) || 24)));
  if (!layer || !KINDS[layer]) return memories;
  return memories.filter(memory => KINDS[layer].has(String(memory.kind || '')));
}
