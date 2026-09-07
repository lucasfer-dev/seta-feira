import { addEvent } from './core.mjs';
import { listEventRules, runEventEngine, saveEventRule } from './event-engine.mjs';
import { createHandoff } from './handoff.mjs';
import { memoryHygieneStatus, searchMemories } from './memory-search.mjs';
import { modelRouterStatus } from './model-router.mjs';
import { getRoutine, listRoutines, matchRoutine, recordRoutineRun, saveRoutine } from './routines.mjs';

const obj = (properties = {}, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });

export const V4_TOOL_DECLARATIONS = [
  { name: 'routine_list', description: 'Lista as rotinas/skills determinísticas salvas na SEXTA, incluindo aliases de ativação.', parameters: obj({}) },
  { name: 'routine_match', description: 'Encontra a rotina que melhor corresponde a uma frase natural do usuário, sem executá-la.', parameters: obj({ query: str('Frase do usuário, como modo programação ou preparar aula.') }, ['query']) },
  { name: 'routine_save', description: 'Salva uma rotina reutilizável pedida explicitamente pelo usuário. Só aceita ferramentas não-destrutivas da allowlist de rotinas.', parameters: obj({ name: str('Nome da rotina.'), description: str('Descrição curta.'), aliases: { type: 'array', items: { type: 'string' }, description: 'Frases curtas alternativas para ativar a rotina.' }, steps: { type: 'array', description: 'Passos em ordem.', items: { type: 'object', properties: { tool: str('Nome exato da ferramenta.'), args: { type: 'object', description: 'Argumentos da ferramenta.' } }, required: ['tool'] } } }, ['name', 'steps']) },
  { name: 'routine_run', description: 'Executa uma rotina/skill salva. Pode receber nome, alias ou frase natural. A execução é limitada aos passos não-destrutivos validados ao salvar.', parameters: obj({ name: str('Nome, ID, alias ou frase que identifica a rotina.') }, ['name']) },
  { name: 'event_rule_list', description: 'Lista regras proativas do Event Engine.', parameters: obj({}) },
  { name: 'event_rule_save', description: 'Cria ou atualiza uma regra proativa de notificação. Não executa compras, envios ou exclusões; apenas observa e notifica.', parameters: obj({ name: str('Nome da regra.'), type: { type: 'string', enum: ['device_online','device_offline','device_stale','memory_above','cpu_above','disk_free_below','battery_below','gmail_sender','gmail_subject','notification_keyword','schedule_daily','schedule_weekdays'] }, condition: { type: 'object', description: 'Condição. Exemplos: {percent:90}, {minutes:5}, {contains:"Gabriel"}, {time:"08:00",timezone:"America/Sao_Paulo",days:[1,2,3,4,5]}.' }, title: str('Título da notificação.'), body: str('Texto da notificação.') }, ['name','type','condition']) },
  { name: 'event_engine_run', description: 'Executa uma checagem imediata das regras proativas, sem criar ações destrutivas.', parameters: obj({}) },
  { name: 'memory_search', description: 'Busca memórias da SEXTA por relevância sem depender só da ordem/importance.', parameters: obj({ query: str('O que precisa ser lembrado.'), limit: num('Quantidade máxima de resultados, até 20.') }, ['query']) },
  { name: 'memory_hygiene_status', description: 'Analisa memórias potencialmente duplicadas sem excluir nada.', parameters: obj({}) },
  { name: 'device_handoff', description: 'Transfere contexto para outro dispositivo conectado e, opcionalmente, abre URL/app/projeto no PC. Só ações locais seguras são aceitas.', parameters: obj({ target: { type: 'string', enum: ['pc','android','browser'] }, summary: str('Contexto que deve continuar no outro dispositivo.'), action: { type: 'object', properties: { name: { type: 'string', enum: ['open_url','open_project','open_app'] }, args: { type: 'object' } } } }, ['target','summary']) },
  { name: 'model_router_status', description: 'Mostra quais rotas de modelos estão configuradas, sem revelar chaves.', parameters: obj({}) }
];
const NAMES = new Set(V4_TOOL_DECLARATIONS.map(tool => tool.name));
export function isV4Tool(name) { return NAMES.has(String(name || '')); }

export async function executeV4Tool(name, args = {}, options = {}, runtime = {}) {
  if (name === 'routine_list') return { ok: true, handled: true, scope: 'routine', routines: await listRoutines() };
  if (name === 'routine_match') {
    const match = await matchRoutine(args.query);
    return { ok: true, handled: true, scope: 'routine', match: match ? { score: match.score, routine: match.routine } : null };
  }
  if (name === 'routine_save') return { ok: true, handled: true, scope: 'routine', routine: await saveRoutine(args) };
  if (name === 'routine_run') {
    let routine = await getRoutine(args.name);
    if (!routine) routine = (await matchRoutine(args.name))?.routine || null;
    if (!routine) throw new Error('ROUTINE_NOT_FOUND');
    if (typeof runtime.execute !== 'function') throw new Error('ROUTINE_EXECUTOR_UNAVAILABLE');
    const trace = [];
    await addEvent({ level: 'info', title: `Rotina iniciada • ${routine.name}`, body: routine.description || 'Executando skill determinística.', metadata: { kind: 'routine', routineId: routine.id, phase: 'start' } }).catch(() => {});
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
        await recordRoutineRun(routine.id, { ok: false }).catch(() => {});
        await addEvent({ level: 'warning', title: `Rotina interrompida • ${routine.name}`, body: `Parou no passo ${index + 1}: ${step.tool}.`, metadata: { kind: 'routine', routineId: routine.id, phase: 'stopped', step: index + 1, tool: step.tool } }).catch(() => {});
        return { ok: false, handled: true, scope: 'routine', state: 'stopped', routine: routine.name, trace };
      }
    }
    await recordRoutineRun(routine.id, { ok: true }).catch(() => {});
    await addEvent({ level: 'info', title: `Rotina concluída • ${routine.name}`, body: `${routine.steps.length} passo(s) concluídos.`, metadata: { kind: 'routine', routineId: routine.id, phase: 'completed' } }).catch(() => {});
    return { ok: true, handled: true, scope: 'routine', state: 'completed', routine: routine.name, trace };
  }
  if (name === 'event_rule_list') return { ok: true, handled: true, scope: 'event-engine', rules: await listEventRules() };
  if (name === 'event_rule_save') return { ok: true, handled: true, scope: 'event-engine', rule: await saveEventRule(args) };
  if (name === 'event_engine_run') return { ok: true, handled: true, scope: 'event-engine', ...(await runEventEngine()) };
  if (name === 'memory_search') return { ok: true, handled: true, scope: 'memory', results: await searchMemories(args.query, { limit: args.limit }) };
  if (name === 'memory_hygiene_status') return { ok: true, handled: true, scope: 'memory', ...(await memoryHygieneStatus()) };
  if (name === 'device_handoff') return { ok: true, handled: true, scope: 'handoff', handoff: await createHandoff({ fromDeviceId: options.deviceId || '', ...args }) };
  if (name === 'model_router_status') return { ok: true, handled: true, scope: 'model-router', ...modelRouterStatus() };
  throw new Error('V4_TOOL_NOT_ALLOWED');
}
