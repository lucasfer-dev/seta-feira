const rules = [
  { intent: 'computer.openApp', re: /^(?:abre|abrir|inicia|iniciar|executa|executar)\s+(?:o\s+|a\s+)?(.+)$/i, build: m => ({ app: m[1].trim() }) },
  { intent: 'computer.closeWindow', re: /^(?:fecha|fechar|encerra|encerrar)\s+(?:isso|essa janela|esta janela)$/i, build: () => ({ target: 'activeWindow' }) },
  { intent: 'computer.minimizeWindow', re: /^(?:minimiza|minimizar)\s+(?:isso|essa janela|esta janela)$/i, build: () => ({ target: 'activeWindow' }) },
  { intent: 'computer.screenshot', re: /^(?:tira|tirar|faz|fazer)\s+(?:um\s+)?(?:print|screenshot|captura de tela)$/i, build: () => ({}) },
  { intent: 'media.pause', re: /^(?:pausa|pause|pausar)$/i, build: () => ({}) },
  { intent: 'media.play', re: /^(?:continua|continue|play|reproduz|reproduzir)$/i, build: () => ({}) },
  { intent: 'audio.volumeUp', re: /^(?:aumenta|aumentar|sobe|subir)\s+(?:o\s+)?volume$/i, build: () => ({}) },
  { intent: 'audio.volumeDown', re: /^(?:diminui|diminuir|abaixa|abaixar)\s+(?:o\s+)?volume$/i, build: () => ({}) }
];

export function detectReflex(text = '') {
  const value = String(text || '').trim();
  if (!value) return null;
  for (const rule of rules) {
    const match = value.match(rule.re);
    if (!match) continue;
    return {
      mode: 'reflex',
      intent: rule.intent,
      input: rule.build(match),
      confidence: 1
    };
  }
  return null;
}

export function listReflexRules() {
  return rules.map(({ intent, re }) => ({ intent, pattern: re.source }));
}
