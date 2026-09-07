(() => {
  const modal = document.querySelector('.s3-agent-modal .s3-modal-grid');
  if (!modal || window.__sextaDecisionGate) return;

  const card = document.createElement('section');
  card.className = 's3-control-card full';
  card.id = 's3DecisionGate';
  card.innerHTML = `
    <h3>DECISION GATE</h3>
    <p>Ações sensíveis nunca atravessam este painel automaticamente. Quando a SEXTA parar antes de enviar, excluir, comprar, pagar ou confirmar algo irreversível, o motivo aparece aqui.</p>
    <div id="s3DecisionList" class="s3-decision-list"><div class="s3-decision-empty">Nenhuma decisão pendente.</div></div>
    <div class="s3-decision-foot"><span>CONFIRMAÇÕES FINANCEIRAS / IRREVERSÍVEIS CONTINUAM LOCAIS</span><button type="button" class="s3-control-button" id="s3DecisionActivity">ABRIR LOG</button></div>`;
  modal.append(card);

  const token = () => localStorage.getItem('sexta_token') || '';
  const headers = () => ({ ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const sensitive = /SENSITIVE|PASSWORD|USER_ACTION|CONFIRM|PAY|PAGAR|COMPRAR|TRANSFER|EXCLUIR|DELETE|ENVIAR|PUBLICAR|IRREVERS/i;

  function relative(date) {
    const ms = Date.now() - new Date(date || 0).getTime();
    if (!Number.isFinite(ms) || ms < 0) return 'agora';
    if (ms < 60_000) return 'agora';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min`;
    return `${Math.floor(ms / 3_600_000)} h`;
  }

  async function refresh() {
    if (!token()) return;
    try {
      const response = await fetch('/api/sync?fresh=1', { headers: headers() });
      if (!response.ok) return;
      const data = await response.json();
      const agent = (data.devices || []).find(device => device.online && (device.context?.pcAgent || device.kind === 'agent')) || null;
      const protocol = Number(agent?.context?.agentProtocol || 0);
      const chip = document.querySelector('#s3AgentChip');
      if (agent && protocol > 0 && protocol < 3) {
        chip?.classList.remove('ok'); chip?.classList.add('warn');
        const label = chip?.querySelector('span'); if (label) label.textContent = 'UPDATE';
        const modalStatus = document.querySelector('#s3ModalStatus');
        if (modalStatus) modalStatus.textContent = `${agent.name || 'PC'} está no protocolo ${protocol}. Rode npm run sexta:update no PC antes de usar o modo Autônomo.`;
      }

      const matches = (data.events || []).filter(event => sensitive.test(`${event.title || ''} ${event.body || ''} ${JSON.stringify(event.metadata || {})}`)).slice(0, 4);
      const list = document.querySelector('#s3DecisionList');
      if (!list) return;
      list.innerHTML = matches.length ? matches.map(event => `
        <article class="s3-decision-item">
          <div><strong>${escapeHtml(event.title || 'Ação interrompida')}</strong><small>${escapeHtml(event.body || 'A SEXTA parou antes da etapa final.')}</small></div>
          <span>${relative(event.created_at)}</span>
        </article>`).join('') : '<div class="s3-decision-empty">Nenhuma decisão pendente.</div>';
    } catch {}
  }

  document.querySelector('#s3DecisionActivity')?.addEventListener('click', () => {
    document.querySelector('.s3-agent-modal')?.close?.();
    document.body.classList.add('sexta-v3-panel-open');
    document.querySelector('.nav-item[data-view="activity"]')?.click();
  });

  const originalOpen = window.__sextaV3?.openAgent;
  if (originalOpen) {
    window.__sextaV3.openAgent = (...args) => { const result = originalOpen(...args); void refresh(); return result; };
  }
  document.querySelector('#s3AgentBtn')?.addEventListener('click', () => void refresh());
  document.querySelector('#s3AgentCard')?.addEventListener('click', () => void refresh());
  window.addEventListener('focus', () => void refresh());
  void refresh();

  window.__sextaDecisionGate = { refresh };
})();
