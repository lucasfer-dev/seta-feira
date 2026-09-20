import { ensureVaultSeed, getVaultNotes, parseJson, saveVaultNote, send } from '../lib/core.mjs';
import { isAgentRequest } from '../lib/agent-auth.mjs';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const deviceIdFromQuery = String(url.searchParams.get('deviceId') || '').trim();

  if (req.method === 'GET') {
    if (!deviceIdFromQuery || !isAgentRequest(req, deviceIdFromQuery)) return send(res, 401, { error: 'unauthorized' });
    try {
      await ensureVaultSeed();
      const notes = await getVaultNotes({ limit: 500 });
      return send(res, 200, { notes });
    } catch (error) {
      return send(res, 500, { error: 'agent_vault_failed', message: error.message });
    }
  }

  if (req.method === 'POST') {
    const body = await parseJson(req);
    const deviceId = String(body.deviceId || '').trim();
    if (!deviceId || !isAgentRequest(req, deviceId)) return send(res, 401, { error: 'unauthorized' });
    try {
      const incoming = Array.isArray(body.notes) ? body.notes.slice(0, 500) : [];
      let saved = 0; let conflicts = 0;
      for (const note of incoming) {
        if (!note?.path || typeof note.markdown !== 'string') continue;
        const result = await saveVaultNote({
          path: note.path,
          title: note.title,
          markdown: note.markdown,
          kind: note.kind || 'obsidian',
          tags: note.tags || ['sexta','obsidian'],
          links: note.links || [],
          sourceMemoryId: note.sourceMemoryId || note.source_memory_id || null,
          clientUpdatedAt: note.clientUpdatedAt || null
        });
        if (result?.conflict) conflicts += 1;
        else saved += 1;
      }
      return send(res, 200, { ok: true, saved, conflicts });
    } catch (error) {
      return send(res, 500, { error: 'agent_vault_failed', message: error.message });
    }
  }

  return send(res, 405, { error: 'method_not_allowed' });
}
