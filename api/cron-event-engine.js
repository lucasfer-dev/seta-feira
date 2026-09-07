import { send } from '../lib/core.mjs';
import { runEventEngine } from '../lib/event-engine.mjs';

function authorizedCron(req) {
  const secret = String(process.env.CRON_SECRET || '');
  const auth = String(req.headers?.authorization || req.headers?.Authorization || '');
  if (secret) return { ok: auth === `Bearer ${secret}`, mode: 'cron-secret' };

  // Vercel envia este header somente em invocações configuradas pelo Cron.
  // Sem CRON_SECRET, mantemos um modo degradado porque o Event Engine é
  // estritamente observacional/idempotente e não executa ações destrutivas.
  const schedule = String(req.headers?.['x-vercel-cron-schedule'] || '');
  return { ok: Boolean(schedule), mode: schedule ? 'vercel-cron-header' : 'missing-secret' };
}

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { error: 'method_not_allowed' });
  const auth = authorizedCron(req);
  if (!auth.ok) {
    return send(res, process.env.CRON_SECRET ? 401 : 503, {
      error: process.env.CRON_SECRET ? 'unauthorized' : 'cron_secret_required',
      message: process.env.CRON_SECRET
        ? 'Cron não autorizado.'
        : 'Defina CRON_SECRET na Vercel para autenticação forte. Invocações reais do Vercel Cron continuam aceitas pelo header de schedule.'
    });
  }

  try {
    const result = await runEventEngine({ now: new Date() });
    return send(res, 200, { ok: true, source: 'vercel-cron', authMode: auth.mode, ...result });
  } catch (error) {
    console.error('[SEXTA Cron Event Engine]', error);
    return send(res, 500, { error: 'event_engine_cron_failed', message: String(error?.message || error).slice(0, 1200) });
  }
}
