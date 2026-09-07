import { listEventRules, runEventEngine, saveEventRule } from './event-engine.mjs';
import { createHandoff } from './handoff.mjs';
import { modelRouterStatus } from './model-router.mjs';
import { getRoutine, listRoutines, saveRoutine } from './routines.mjs';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });

export const V4_TOOL_DECLARATIONS = [
  { name: 'routine_list', description: 'Lista as rotinas/skills determinísticas salvas na SEXTA.', parameters: obj({}) },
  { name: 'routine_save', description: 'Salva uma rotina reutilizável pedida explicitamente pelo usuário. Só aceita ferramentas não-destrutivas da allowlist de rotinas.', parameters: obj({ name: str('Nome da rotina.'), description: str('Descrição curta.'), steps: { type: 'array', description: 'Passos em ordem.', items: { type: 'object', properties: { tool: str('Nome exato da ferramenta.'), args: { type: 'object', description: 'Argumentos da ferramenta.' } }, required: ['tool'] } } }, ['name', 'steps']) },
  { name: 'routine_run', description: 'Executa uma rotina/skill salva. A execução é limitada aos passos não-destrutivos que foram validados ao salvar.', parameters: obj({ name: str('Nome ou ID da rotina.') }, ['name']) },
  { name: 'event_rule_list', description: 'Lista regras proativas do Event Engine.', parameters: obj({}) },
  { name: 'event_rule_save', description: 'Cria ou atualiza uma regra proativa de notificação. Não executa compras, envios ou exclusões; apenas observa e notifica.', parameters: obj({ name: str('Nome da regra.'), type: { type: 'string', enum: ['device_online','device_offline','memory_above','disk_free_below','gmail_sender','gmail_subject','schedule_daily'] }, condition: { type: 'object', description: 'Condição. Exemplos: {percent:90}, {contains:"Gabriel"}, {time:"08:00",timezone:"America/Sao_Paulo"}.' }, title: str('Título da notificação.'), body: str('Texto da notificação.') }, ['name','type','condition']) },
  { name: 'event_engine_run', description: 'Executa uma checagem imediata das regras proativas, sem criar ações destrutivas.', parameters: obj({}) },
  { name: 'device_handoff', description: 'Transfere contexto para outro dispositivo conectado e, opcionalmente, abre URL/app/projeto no PC. Só ações locais seguras são aceitas.', parameters: obj({ target: { type: 'string', enum: ['pc','android','browser'] }, summary: str('Contexto que deve continuar no outro dispositivo.'), action: { type: 'object', properties: { name: { type: 'string', enum: ['open_url','open_project','open_app'] }, args: { type: 'object' } } } }, ['target','summary']) },
  { name: 'model_router_status', description: 'Mostra quais rotas de modelos estão configuradas, sem revelar chaves.', parameters: obj({}) }
];
const NAMES = new Set(V4_TOOL_DECLARATIONS.map(tool => tool.name));
export function isV4Tool(name) { return NAMES.has(String(name || '')); }

export async function executeV4Tool(name, args = {}, options = {}, runtime = {}) {
  if (name === 'routine_list') return { ok: true, handled: true, scope: 'routine', routines: await listRoutines() };
  if (name === 'routine_save') return { ok: true, handled: true, scope: 'routine', routine: await saveRoutine(args) };
  if (name === 'routine_run') {
    const routine = await getRoutine(args.name);
    if (!routine) throw new Error('ROUTINE_NOT_FOUND');
    if (typeof runtime.execute !== 'function') throw new Error('ROUTINE_EXECUTOR_UNAVAILABLE');
    const trace = [];
    for (let index = 0; index < routine.steps.length; index += 1) {
      const step = routine.steps[index];
      let result;
      try {
        result = await runtime.execute(step.tool, step.args || {}, { ...options, enforceExplicit: false, routineInternal: true });
      } catch (error) {
        result = { ok: false, state: 'failed', error: String(error?.message || error) };
      }
      trace.push({ step: index + 1, tool: step.tool, result });
      if (result?.ok === false || ['failed', 'confirmation_required', 'user_action_required'].includes(result?.state)) {
        return { ok: false, handled: true, scope: 'routine', state: 'stopped', routine: routine.name, trace };
      }
    }
    return { ok: true, handled: true, scope: 'routine', state: 'completed', routine: routine.name, trace };
  }
  if (name === 'event_rule_list') return { ok: true, handled: true, scope: 'event-engine', rules: await listEventRules() };
  if (name === 'event_rule_save') return { ok: true, handled: true, scope: 'event-engine', rule: await saveEventRule(args) };
  if (name === 'event_engine_run') return { ok: true, handled: true, scope: 'event-engine', ...(await runEventEngine()) };
  if (name === 'device_handoff') return { ok: true, handled: true, scope: 'handoff', handoff: await createHandoff({ fromDeviceId: options.deviceId || '', ...args }) };
  if (name === 'model_router_status') return { ok: true, handled: true, scope: 'model-router', ...modelRouterStatus() };
  throw new Error('V4_TOOL_NOT_ALLOWED');
}
