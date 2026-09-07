(() => {
  if (window.__sextaV4Intelligence?.installed) return;
  const token = () => localStorage.getItem('sexta_token') || '';
  const auth = () => ({ 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const state = { routines: [], rules: [], router: null, hardware: null, device: null, mounted: false, lastError: '' };

  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, headers: { ...auth(), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }
  function prompt(text) {
    const input = document.querySelector('#messageInput'); const form = document.querySelector('#composer');
    if (!input || !form) return;
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit?.();
  }
  function injectStyles() {
    if (document.querySelector('#sextaV4Styles')) return;
    const style = document.createElement('style'); style.id = 'sextaV4Styles'; style.textContent = `
      .s4-intel-card .s4-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.s4-stat{border:1px solid rgba(118,241,255,.15);background:rgba(4,15,21,.45);padding:10px}.s4-stat small{display:block;font-size:9px;letter-spacing:.12em;text-transform:uppercase;opacity:.55}.s4-stat strong{display:block;margin-top:4px;font-size:13px}.s4-intel-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.s4-route-list,.s4-list{display:grid;gap:6px;margin-top:10px}.s4-row{display:flex;justify-content:space-between;gap:12px;font-size:11px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06)}.s4-row span{opacity:.65}.s4-row b{font-weight:600;text-align:right}.s4-status-note{margin-top:10px;font-size:10px;opacity:.6}.s4-rail{margin-top:10px}@media(max-width:720px){.s4-intel-card .s4-grid{grid-template-columns:1fr}}
    `; document.head.append(style);
  }
  function mount() {
    if (state.mounted) return true;
    const modalGrid = document.querySelector('.s3-agent-modal .s3-modal-grid');
    if (!modalGrid) return false;
    injectStyles();
    const card = document.createElement('section'); card.className = 's3-control-card full s4-intel-card'; card.innerHTML = `
      <h3>INTELLIGENCE V4 // PROACTIVE CORE</h3><p>Routines reutilizáveis, regras proativas, roteamento de cérebro e telemetria do corpo Windows.</p>
      <div class="s4-grid"><div class="s4-stat"><small>Routines</small><strong id="s4RoutineCount">—</strong></div><div class="s4-stat"><small>Event Rules</small><strong id="s4RuleCount">—</strong></div><div class="s4-stat"><small>Model Router</small><strong id="s4RouterRoute">—</strong></div><div class="s4-stat"><small>Hardware</small><strong id="s4Hardware">PC OFFLINE</strong></div></div>
      <div class="s4-intel-actions"><button class="s3-control-button" id="s4Refresh">ATUALIZAR</button><button class="s3-control-button" id="s4RunEvents">VERIFICAR EVENTOS</button><button class="s3-control-button" id="s4TeachRoutine">ENSINAR ROTINA</button><button class="s3-control-button" id="s4CreateRule">CRIAR MONITOR</button></div>
      <div class="s4-route-list" id="s4Routes"></div><div class="s4-list" id="s4RuleList"></div><p class="s4-status-note" id="s4Status">Aguardando telemetria.</p>`;
    modalGrid.append(card);
    const rail = document.querySelector('.s3-rail.right');
    if (rail) {
      const panel = document.createElement('section'); panel.className = 's3-panel s4-rail'; panel.innerHTML = `<div class="s3-panel-head"><strong>INTELLIGENCE V4</strong><span>PROACTIVE</span></div><div class="s3-metric"><label>Routines</label><b id="s4RailRoutines">—</b></div><div class="s3-metric"><label>Event rules</label><b id="s4RailRules">—</b></div><div class="s3-metric"><label>PC hardware</label><b id="s4RailHardware">OFFLINE</b></div>`; rail.append(panel);
    }
    document.querySelector('#s4Refresh')?.addEventListener('click', () => void refresh(true));
    document.querySelector('#s4RunEvents')?.addEventListener('click', async () => { try { const data = await api('/api/event-engine', { method:'POST', body:JSON.stringify({action:'run'}) }); document.querySelector('#s4Status').textContent = `${data.checked || 0} regra(s) verificadas • ${data.triggered?.length || 0} acionada(s).`; await refresh(); } catch (error) { document.querySelector('#s4Status').textContent = error.message; } });
    document.querySelector('#s4TeachRoutine')?.addEventListener('click', () => prompt('Sexta, quero te ensinar uma nova rotina. Me ajuda a transformar o que eu disser em passos seguros e salvar como uma skill.'));
    document.querySelector('#s4CreateRule')?.addEventListener('click', () => prompt('Sexta, quero criar um monitor proativo. Me ajuda a definir uma condição e me avise quando ela acontecer.'));
    window.addEventListener('sexta:proactivity-tick', () => void refresh());
    window.addEventListener('sexta:proactive-event', event => { const count = event.detail?.fired?.length || 0; const el = document.querySelector('#s4Status'); if (el && count) el.textContent = `Event Engine acionou ${count} regra(s) agora.`; });
    state.mounted = true; return true;
  }
  function hardwareText(hw) {
    if (!hw?.memory) return 'PC OFFLINE';
    const cpu = Number.isFinite(Number(hw.cpu?.percent)) ? `${hw.cpu.percent}% CPU` : 'CPU —';
    return `${cpu} • ${hw.memory.usedPercent}% RAM`;
  }
  function render() {
    if (!mount()) return;
    const set = (id, value) => { const el = document.querySelector(id); if (el) el.textContent = value; };
    set('#s4RoutineCount', String(state.routines.length)); set('#s4RuleCount', String(state.rules.length)); set('#s4RailRoutines', String(state.routines.length)); set('#s4RailRules', String(state.rules.length));
    const hw = hardwareText(state.hardware); set('#s4Hardware', hw); set('#s4RailHardware', hw === 'PC OFFLINE' ? 'OFFLINE' : hw);
    const route = state.router?.routes?.fast || state.router?.defaultModel || 'CORE'; set('#s4RouterRoute', route);
    const routes = document.querySelector('#s4Routes');
    if (routes) routes.innerHTML = state.router ? Object.entries(state.router.routes || {}).map(([name,model]) => `<div class="s4-row"><span>${esc(name.toUpperCase())}</span><b>${esc(model)}</b></div>`).join('') : '';
    const list = document.querySelector('#s4RuleList');
    if (list) list.innerHTML = state.rules.slice(0,5).map(rule => `<div class="s4-row"><span>${esc(rule.name)}</span><b>${rule.enabled === false ? 'OFF' : esc(rule.type)}</b></div>`).join('') || '<div class="s4-row"><span>Nenhuma regra proativa</span><b>—</b></div>';
    set('#s4Status', state.lastError || `V4 online • ${state.routines.length} skill(s) • ${state.rules.filter(r=>r.enabled!==false).length} monitor(es) ativo(s).`);
  }
  async function refresh(force = false) {
    if (!token()) return;
    if (!mount()) { setTimeout(() => void refresh(force), 800); return; }
    try {
      const [routines, rules, router, sync] = await Promise.all([api('/api/routines'), api('/api/event-engine'), api('/api/model-router'), api(`/api/sync?fresh=${force ? 1 : 0}`)]);
      state.routines = routines.routines || []; state.rules = rules.rules || []; state.router = router;
      const devices = Array.isArray(sync.devices) ? sync.devices : [];
      state.device = devices.find(device => device.online && ['agent','desktop'].includes(String(device.kind || '').toLowerCase())) || null;
      state.hardware = state.device?.context?.hardware || null; state.lastError = ''; render();
    } catch (error) { state.lastError = String(error?.message || error); render(); }
  }
  window.__sextaV4Intelligence = { installed:true, version:'1.0.0', refresh:() => refresh(true), debug:() => ({ ...state }) };
  const boot = setInterval(() => { if (mount()) { clearInterval(boot); void refresh(true); } }, 500);
  setTimeout(() => clearInterval(boot), 20000);
})();
