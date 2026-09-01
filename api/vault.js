import { deleteVaultNote, ensureVaultSeed, getVaultNotes, isOwner, parseJson, saveVaultNote, send } from '../lib/core.mjs';

export default async function handler(req, res) {
  if (!isOwner(req)) return send(res, 401, { error: 'unauthorized' });
  try {
    if (req.method === 'GET') {
      await ensureVaultSeed();
      const url = new URL(req.url, 'http://localhost');
      const since = String(url.searchParams.get('since') || '');
      const notes = await getVaultNotes({ limit: 500, since });
      return send(res, 200, { notes });
    }
    const body = await parseJson(req);
    if (req.method === 'POST') {
      const incoming = Array.isArray(body.notes) ? body.notes.slice(0, 300) : [body.note || body];
      const results = [];
      for (const note of incoming) {
        if (!note?.path || typeof note.markdown !== 'string') continue;
        results.push(await saveVaultNote({
          path: note.path,
          title: note.title,
          markdown: note.markdown,
          kind: note.kind || 'obsidian',
          tags: note.tags || ['sexta','obsidian'],
          links: note.links || [],
          sourceMemoryId: note.sourceMemoryId || note.source_memory_id || null,
          clientUpdatedAt: note.clientUpdatedAt || note.updated_at || null,
          force: body.force === true || note.force === true
        }));
      }
      return send(res, 200, { ok: true, notes: results, conflicts: results.filter(n => n?.conflict).length });
    }
    if (req.method === 'DELETE') {
      await deleteVaultNote(String(body.path || ''));
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: 'vault_failed', message: error.message });
  }
}
