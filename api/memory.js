import { deleteMemory, getMemories, isOwner, parseJson, saveMemory, send } from '../lib/core.mjs';
export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    if (req.method === 'GET') return send(res, 200, { memories: await getMemories(60) });
    const body = await parseJson(req);
    if (req.method === 'POST') {
      await saveMemory({ content: body.content, kind: body.kind || 'fact', importance: Number(body.importance ?? 0.7), source: 'manual' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') {
      await deleteMemory(String(body.id || ''));
      return send(res, 200, { ok: true });
    }
    send(res, 405, { error: 'method_not_allowed' });
  } catch (error) { send(res, 500, { error: 'memory_failed', message: error.message }); }
}
