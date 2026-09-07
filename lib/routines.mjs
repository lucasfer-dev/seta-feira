import crypto from 'node:crypto';
import { deleteVaultNote, getVaultNotes, saveVaultNote } from './core.mjs';

export const ROUTINES_VERSION = '2.0.0';
export const SAFE_ROUTINE_TOOLS = new Set([
  'pc_open_app', 'pc_open_project', 'pc_open_url', 'pc_window_focus', 'pc_ui_scroll', 'pc_ui_hotkey',
  'pc_browser_open', 'pc_browser_back', 'pc_browser_forward', 'pc_browser_reload', 'pc_browser_tabs', 'pc_browser_select_tab',
  'pc_git_status', 'pc_system_info', 'pc_hardware_status',
  'google_unread_email', 'google_calendar_list', 'google_drive_search', 'google_contacts_search', 'memory_list', 'memory_search',
  'android_open_app', 'android_open_settings', 'android_set_volume', 'android_adjust_volume', 'android_flashlight',
  'android_media', 'android_ui_scroll', 'android_ui_back', 'android_ui_home'
]);

function slug(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || crypto.randomUUID();
}
function phrase(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanArgs(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > 12000) throw new Error('ROUTINE_ARGS_TOO_LARGE');
  return JSON.parse(json);
}
function cleanAliases(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(list.map(item => String(item || '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(item => item.length >= 2))].slice(0, 12);
}
function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('ROUTINE_STEPS_REQUIRED');
  if (steps.length > 16) throw new Error('ROUTINE_TOO_MANY_STEPS');
  return steps.map((step, index) => {
    const tool = String(step?.tool || '').trim();
    if (!SAFE_ROUTINE_TOOLS.has(tool)) throw new Error(`ROUTINE_TOOL_BLOCKED:${tool || index}`);
    return { tool, args: cleanArgs(step.args) };
  });
}
function markdownFor(routine) {
  return `# ${routine.name}\n\n${routine.description || 'Rotina da SEXTA.'}\n\n\`\`\`sexta-routine\n${JSON.stringify(routine, null, 2)}\n\`\`\`\n`;
}
function parseNote(note) {
  if (note?.kind !== 'routine') return null;
  const match = String(note.markdown || '').match(/```sexta-routine\s*([\s\S]*?)```/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
async function persistRoutine(routine) {
  await saveVaultNote({
    path: `routines/${routine.id}.md`, title: routine.name, markdown: markdownFor(routine), kind: 'routine',
    tags: ['sexta', 'routine'], links: [], force: true
  });
  return routine;
}

export async function listRoutines() {
  const notes = await getVaultNotes({ limit: 500 });
  return notes.map(parseNote).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
export async function getRoutine(idOrName = '') {
  const key = String(idOrName || '').trim().toLowerCase();
  return (await listRoutines()).find(item => item.id === key || String(item.name || '').toLowerCase() === key || slug(item.name) === slug(key)) || null;
}
export async function matchRoutine(input = '') {
  const query = phrase(input);
  if (!query) return null;
  const routines = await listRoutines();
  let best = null;
  for (const routine of routines) {
    const candidates = [routine.name, ...(Array.isArray(routine.aliases) ? routine.aliases : [])].map(phrase).filter(Boolean);
    let score = 0;
    for (const candidate of candidates) {
      if (query === candidate) score = Math.max(score, 100);
      if (query === `modo ${candidate}` || query === `rotina ${candidate}` || query === `executa ${candidate}` || query === `execute ${candidate}`) score = Math.max(score, 98);
      if (query.includes(candidate) && candidate.length >= 4) score = Math.max(score, 80 + Math.min(15, candidate.length / 8));
      const qTokens = new Set(query.split(' ').filter(Boolean));
      const cTokens = candidate.split(' ').filter(Boolean);
      if (cTokens.length) {
        const overlap = cTokens.filter(token => qTokens.has(token)).length / cTokens.length;
        score = Math.max(score, overlap * 70);
      }
    }
    if (!best || score > best.score) best = { routine, score };
  }
  return best && best.score >= 55 ? best : null;
}
export async function saveRoutine(input = {}) {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (name.length < 2) throw new Error('ROUTINE_NAME_REQUIRED');
  const existing = input.id ? await getRoutine(input.id) : await getRoutine(name);
  const now = new Date().toISOString();
  const routine = {
    version: ROUTINES_VERSION,
    id: String(existing?.id || input.id || slug(name)).toLowerCase().slice(0, 80),
    name,
    description: String(input.description ?? existing?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500),
    aliases: cleanAliases(input.aliases ?? existing?.aliases ?? []),
    steps: validateSteps(input.steps ?? existing?.steps),
    runCount: Math.max(0, Number(existing?.runCount) || 0),
    lastRunAt: String(existing?.lastRunAt || ''),
    lastRunOk: existing?.lastRunOk !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  return persistRoutine(routine);
}
export async function recordRoutineRun(idOrName, { ok = true } = {}) {
  const routine = await getRoutine(idOrName);
  if (!routine) return null;
  routine.runCount = Math.max(0, Number(routine.runCount) || 0) + 1;
  routine.lastRunAt = new Date().toISOString();
  routine.lastRunOk = ok === true;
  routine.updatedAt = routine.lastRunAt;
  return persistRoutine(routine);
}
export async function deleteRoutine(idOrName = '') {
  const routine = await getRoutine(idOrName);
  if (!routine) return false;
  await deleteVaultNote(`routines/${routine.id}.md`);
  return true;
}
