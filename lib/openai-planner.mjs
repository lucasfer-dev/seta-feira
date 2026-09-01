const DEFAULT_MODEL = 'gpt-5.6-sol';
const DEFAULT_REASONING = 'high';
const ALLOWED_REASONING = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    steps: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          order: { type: 'integer' },
          action: { type: 'string' },
          tool: { type: 'string' },
          arguments_hint: { type: 'string' },
          requires_confirmation: { type: 'boolean' }
        },
        required: ['order', 'action', 'tool', 'arguments_hint', 'requires_confirmation']
      }
    },
    completion_criteria: { type: 'string' },
    limitations: { type: 'array', items: { type: 'string' } }
  },
  required: ['summary', 'steps', 'completion_criteria', 'limitations']
};

function plannerModel() {
  return String(process.env.OPENAI_PLANNER_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

function plannerReasoning() {
  const value = String(process.env.OPENAI_PLANNER_REASONING || DEFAULT_REASONING).trim().toLowerCase();
  return ALLOWED_REASONING.has(value) ? value : DEFAULT_REASONING;
}

function compactTools(tools = []) {
  return (Array.isArray(tools) ? tools : [])
    .filter(tool => tool?.name && tool.name !== 'openai_plan_complex_task')
    .slice(0, 80)
    .map(tool => `- ${tool.name}: ${String(tool.description || '').replace(/\s+/g, ' ').trim().slice(0, 260)}`)
    .join('\n');
}

function extractOutputText(data = {}) {
  const chunks = [];
  for (const item of Array.isArray(data.output) ? data.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function parsePlan(text = '') {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('OPENAI_PLANNER_EMPTY_OUTPUT');
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('OPENAI_PLANNER_INVALID_JSON');
    return JSON.parse(match[0]);
  }
}

export function openaiPlannerStatus() {
  return {
    configured: Boolean(String(process.env.OPENAI_API_KEY || '').trim()),
    model: plannerModel(),
    reasoningEffort: plannerReasoning()
  };
}

export async function planComplexTask({ request = '', context = '', tools = [] } = {}) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('OPENAI_PLANNER_NOT_CONFIGURED');

  const task = String(request || '').replace(/\s+/g, ' ').trim().slice(0, 10000);
  if (!task) throw new Error('OPENAI_PLANNER_REQUEST_REQUIRED');

  const relevantContext = String(context || '').trim().slice(0, 8000);
  const toolList = compactTools(tools);
  const model = plannerModel();
  const reasoningEffort = plannerReasoning();

  const instructions = [
    'Você é o planejador interno de tarefas complexas da SEXTA-feira.',
    'Sua função é transformar um pedido complexo em um plano curto, executável e seguro para a SEXTA seguir usando SOMENTE as ferramentas disponíveis.',
    'Não execute ações, não afirme que algo já foi feito e não escreva uma resposta final ao usuário.',
    'Não exponha cadeia de pensamento. Forneça apenas o plano estruturado solicitado.',
    'Prefira poucos passos objetivos. Preserve a ordem quando um passo depende do resultado anterior.',
    'Se uma ação exigir envio, publicação, exclusão, alteração destrutiva ou outra decisão sensível que não esteja explicitamente autorizada no pedido, marque requires_confirmation=true.',
    'Se nenhuma ferramenta disponível puder realizar um passo, deixe tool como string vazia e registre a limitação.',
    '',
    'FERRAMENTAS DISPONÍVEIS:',
    toolList || '- nenhuma ferramenta executável informada'
  ].join('\n');

  const input = [
    `PEDIDO DO USUÁRIO:\n${task}`,
    relevantContext ? `CONTEXTO RELEVANTE:\n${relevantContext}` : ''
  ].filter(Boolean).join('\n\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      instructions,
      input,
      reasoning: { effort: reasoningEffort, summary: 'concise' },
      text: {
        format: {
          type: 'json_schema',
          name: 'sexta_complex_plan',
          strict: true,
          schema: PLAN_SCHEMA
        }
      },
      max_output_tokens: 4000,
      store: false
    }),
    signal: AbortSignal.timeout(45000)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `openai_planner_http_${response.status}`;
    throw new Error(`OPENAI_PLANNER_${response.status}: ${message}`);
  }

  const plan = parsePlan(extractOutputText(data));
  const steps = Array.isArray(plan.steps) ? plan.steps.slice(0, 12) : [];

  return {
    ok: true,
    handled: true,
    scope: 'openai-planner',
    state: 'completed',
    model,
    reasoningEffort,
    responseId: String(data.id || ''),
    plan: {
      summary: String(plan.summary || '').slice(0, 1600),
      steps: steps.map((step, index) => ({
        order: Number.isFinite(Number(step?.order)) ? Number(step.order) : index + 1,
        action: String(step?.action || '').slice(0, 1200),
        tool: String(step?.tool || '').slice(0, 128),
        arguments_hint: String(step?.arguments_hint || '').slice(0, 1800),
        requires_confirmation: Boolean(step?.requires_confirmation)
      })),
      completion_criteria: String(plan.completion_criteria || '').slice(0, 1800),
      limitations: (Array.isArray(plan.limitations) ? plan.limitations : []).slice(0, 12).map(item => String(item).slice(0, 1000))
    }
  };
}
