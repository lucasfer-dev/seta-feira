const IMPORTANT_WORDS = [
  'urgente','urgência','urgencia','importante','prazo','hoje','amanhã','amanha','agora','reunião','reuniao','horário','horario',
  'confirma','confirmar','preciso','necessário','necessario','problema','falha','erro','pagamento','documento','entrevista','processo',
  'aula','oficina','trabalho','coordenação','coordenacao','coordenadora','rh','chefe','professor','faculdade','projeto'
];
const LOW_VALUE = ['newsletter','promoção','promocao','oferta','cupom','marketing','unsubscribe','no-reply','noreply'];

function normalize(value='') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

function vipList() {
  return String(process.env.SEXTA_VIP_CONTACTS || '')
    .split(',').map(x => normalize(x.trim())).filter(Boolean);
}

export function classifyPriority({ source='unknown', sender='', title='', body='', metadata={} } = {}) {
  const hay = normalize(`${sender} ${title} ${body}`);
  let score = source === 'whatsapp' ? 45 : source === 'gmail' ? 32 : 20;
  const reasons = [];

  if (metadata?.gmailImportant || metadata?.labels?.includes?.('IMPORTANT')) {
    score += 28; reasons.push('marcado como importante pelo Gmail');
  }
  const vips = vipList();
  if (vips.some(v => hay.includes(v))) { score += 30; reasons.push('remetente prioritário'); }
  const hits = IMPORTANT_WORDS.filter(w => hay.includes(normalize(w))).slice(0,4);
  if (hits.length) { score += Math.min(34, hits.length * 11); reasons.push(`sinais: ${hits.join(', ')}`); }
  if (/\?|preciso|pode|consegue|confirma|responde|retorno|me avisa/.test(hay)) {
    score += 10; reasons.push('parece pedir resposta/ação');
  }
  if (LOW_VALUE.some(w => hay.includes(normalize(w)))) {
    score -= 25; reasons.push('conteúdo promocional/automático');
  }
  if (metadata?.isGroup) { score -= 12; reasons.push('mensagem de grupo'); }
  if (metadata?.fromMe) score = 0;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 82 ? 'urgent' : score >= 62 ? 'important' : score >= 38 ? 'normal' : 'low';
  return { score, level, reason: reasons.join('; ') || 'prioridade padrão' };
}
