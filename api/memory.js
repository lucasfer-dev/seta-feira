import { deleteMemory, getMemories, isOwner, parseJson, saveMemory, send } from '../lib/core.mjs';
import { queueVaultSync } from '../lib/v2/home-hub.mjs';

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    if (req.method === 'GET') return send(res, 200, { memories: await getMemories(60) });
    const body = await parseJson(req);
    if (req.method === 'POST') {
      const saved = await saveMemory({ content: body.content, kind: body.kind || 'fact', importance: Number(body.importance ?? 0.7), source: 'manual' });
      queueVaultSync({ source: 'memory', reason: 'memory_created', memoryId: saved?.id || null });
      return send(res, 200, { ok: true, memory: saved || null });
    }
    if (req.method === 'DELETE') {
      const id = String(body.id || '');
      await deleteMemory(id);
      queueVaultSync({ source: 'memory', reason: 'memory_deleted', memoryId: id });
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'method_not_allowed' });
  } catch (error) { send(res, 500, { error: 'memory_failed', message: error.message }); }
}
