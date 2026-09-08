(() => {
  if (window.__sextaWindowsAccess?.installed) return;

  const state = {
    mounted: false,
    device: null,
    busy: false,
    error: '',
    lastUpdatedAt: 0
  };

  const token = () => localStorage.getItem('sexta_token') || '';
  const headers = () => ({
    'Content-Type': 'application/json',
    ...(token() ? { Authorization: `Bearer ${token()}` } : {})
  });

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...headers(), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    return data;
  }

  function injectStyles() {
    if (document.querySelector('#sextaWindowsAccessStyles')) return;
    const style = document.createElement('style');
    style.id = 'sextaWindowsAccessStyles';
    style.textContent = `
      .swa-card{grid-column:1/-1;display:grid;gap:14px;border:1px solid rgba(118,241,255,.16);background:linear-gradient(180deg,rgba(6,20,29,.76),rgba(3,11,17,.78));padding:18px;border-radius:14px}
      .swa-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.swa-head h3{margin:3px 0 5px;font-size:18px}.swa-head p{margin:0;opacity:.7;max-width:760px;line-height:1.5}.swa-badge{font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:6px 9px;border:1px solid rgba(255,255,255,.12);border-radius:999px;white-space:nowrap}.swa-badge.ok{border-color:rgba(100,255,190,.35)}.swa-badge.off{opacity:.55}
      .swa-master{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:14px;border:1px solid rgba(118,241,255,.14);border-radius:12px;background:rgba(255,255,255,.025)}.swa-master strong{display:block}.swa-master small{display:block;margin-top:4px;opacity:.62;line-height:1.4}.swa-switch{position:relative;width:52px;height:28px;flex:0 0 auto}.swa-switch input{position:absolute;opacity:0}.swa-switch span{position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.12);cursor:pointer;transition:.2s}.swa-switch span:before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;border-radius:50%;background:#d7e6eb;transition:.2s}.swa-switch input:checked+span{background:rgba(32,197,151,.28);border-color:rgba(64,255,197,.38)}.swa-switch input:checked+span:before{transform:translateX(24px);background:#7effcf}
      .swa-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.swa-permission{display:flex;align-items:flex-start;gap:10px;padding:11px;border:1px solid rgba(255,255,255,.07);border-radius:10px}.swa-permission input{margin-top:3px}.swa-permission strong{display:block;font-size:12px}.swa-permission small{display:block;margin-top:3px;opacity:.58;line-height:1.35}
      .swa-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.swa-row select{min-width:210px}.swa-actions{display:flex;gap:9px;flex-wrap:wrap}.swa-note{font-size:10px;line-height:1.45;opacity:.58}.swa-status{font-size:11px;min-height:16px;opacity:.75}.swa-status.error{color:#ffb3b3}.swa-capabilities{display:flex;gap:6px;flex-wrap:wrap}.swa-capabilities span{font-size:9px;letter-spacing:.06em;text-transform:uppercase;border:1px solid rgba(255,255,255,.08);padding:5px 7px;border-radius:7px;opacity:.72}
      @media(max-width:720px){.swa-grid{grid-template-columns:1fr}.swa-head,.swa-master{align-items:flex-start}.swa-head{flex-direction:column}}
    `;
    document.head.append(style);
  }

  function mount() {
    if (state.mounted) return true;
    const layout = document.querySelector('#view-settings .settings-layout');
    if (!layout) return false;
    injectStyles();

    const card = document.createElement('section');
    card.className = 'swa-card';
    card.id = 'sextaWindowsAccessCard';
    card.innerHTML = `
      <div class="swa-head">
        <div><p class="eyebrow">WINDOWS ACCESS</p><h3>Controle do Windows</h3><p>Você decide aqui o que a SEXTA pode observar e controlar no PC. As permissões são aplicadas no Agent local e continuam valendo mesmo que a página seja recarregada.</p></div>
        <span class="swa-badge off" id="swaOnlineBadge">PC OFFLINE</span>
      </div>

      <label class="swa-master">
        <div><strong>Controle completo da interface</strong><small>Ativa tela, interpretação visual, UI Automation, navegador, clipboard e telemetria. A SEXTA continua bloqueando senha, pagamento, exclusão e terminal arbitrário.</small></div>
        <span class="swa-switch"><input type="checkbox" id="swaMaster"><span></span></span>
      </label>

      <div class="swa-grid">
        <label class="swa-permission"><input type="checkbox" data-swa-privacy="screen"><div><strong>Ver e interpretar a tela</strong><small>Captura pontual + visão multimodal quando você pedir.</small></div></label>
        <label class="swa-permission"><input type="checkbox" data-swa-privacy="uiAutomation"><div><strong>Clicar, digitar e navegar</strong><small>Usa Windows UI Automation por nome/elemento; evita clique cego por coordenada.</small></div></label>
        <label class="swa-permission"><input type="checkbox" data-swa-privacy="browser"><div><strong>Controlar navegador</strong><small>DOM/CDP para abrir páginas, ler elementos, clicar e preencher campos não sensíveis.</small></div></label>
        <label class="swa-permission"><input type="checkbox" data-swa-privacy="clipboard"><div><strong>Clipboard</strong><small>Ler ou copiar texto quando uma tarefa exigir e você tiver pedido.</small></div></label>
        <label class="swa-permission"><input type="checkbox" data-swa-privacy="hardware"><div><strong>Telemetria do PC</strong><small>CPU, RAM, disco, GPU, bateria e rede local estruturada.</small></div></label>
      </div>

      <div class="swa-row">
        <label><strong style="font-size:12px">Nível de autonomia</strong><br><select id="swaAutonomy"><option value="observer">Observador — somente leitura</option><option value="assistant">Assistente — executa seus pedidos</option><option value="autonomous">Autônomo — permite tarefas multi-etapas explícitas</option></select></label>
      </div>

      <div class="swa-capabilities"><span>abrir apps</span><span>focar janelas</span><span>ver tela</span><span>interpretar tela</span><span>UI tree</span><span>clicar por elemento</span><span>digitar</span><span>rolar</span><span>atalhos seguros</span><span>browser DOM</span></div>

      <div class="swa-actions"><button class="primary-btn" type="button" id="swaEnableAll">Ativar controle completo</button><button class="secondary-btn" type="button" id="swaSave">Aplicar permissões</button><button class="secondary-btn" type="button" id="swaPause">Pausar Agent</button><button class="secondary-btn" type="button" id="swaRefresh">Atualizar status</button></div>
      <p class="swa-status" id="swaStatus">Procurando o PC Agent...</p>
      <p class="swa-note">“Controle completo” significa controle da interface visível e ferramentas permitidas. A SEXTA não recebe shell genérico, não lê campos de senha e não contorna confirmações sensíveis.</p>
    `;
    layout.append(card);

    document.querySelector('#swaEnableAll')?.addEventListener('click', () => void enableAll());
    document.querySelector('#swaSave')?.addEventListener('click', () => void saveCurrent());
    document.querySelector('#swaPause')?.addEventListener('click', () => void togglePause());
    document.querySelector('#swaRefresh')?.addEventListener('click', () => void refresh(true));
    document.querySelector('#swaMaster')?.addEventListener('change', event => {
      const checked = Boolean(event.target.checked);
      document.querySelectorAll('[data-swa-privacy]').forEach(input => { input.checked = checked; });
    });

    state.mounted = true;
    return true;
  }

  function pcFromDevices(devices = []) {
    return devices.find(device => {
      const kind = String(device?.kind || '').toLowerCase();
      const context = device?.context || {};
      return Boolean(device?.online && (kind === 'agent' || context.pcAgent === true));
    }) || null;
  }

  function currentPrivacy() {
    const privacy = {};
    document.querySelectorAll('[data-swa-privacy]').forEach(input => {
      privacy[input.dataset.swaPrivacy] = Boolean(input.checked);
    });
    return privacy;
  }

  function setStatus(message, error = false) {
    const el = document.querySelector('#swaStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', error);
  }

  function render() {
    if (!mount()) return;
    const device = state.device;
    const context = device?.context || {};
    const privacy = context.privacy || {};
    const badge = document.querySelector('#swaOnlineBadge');
    if (badge) {
      badge.textContent = device ? `${device.name || 'PC'} ONLINE` : 'PC OFFLINE';
      badge.classList.toggle('ok', Boolean(device));
      badge.classList.toggle('off', !device);
    }

    document.querySelectorAll('[data-swa-privacy]').forEach(input => {
      const key = input.dataset.swaPrivacy;
      input.checked = privacy[key] === true;
      input.disabled = !device || state.busy;
    });

    const permissionKeys = ['screen', 'clipboard', 'uiAutomation', 'browser', 'hardware'];
    const full = Boolean(device) && permissionKeys.every(key => privacy[key] === true) && context.paused !== true && context.autonomy !== 'observer';
    const master = document.querySelector('#swaMaster');
    if (master) { master.checked = full; master.disabled = !device || state.busy; }

    const autonomy = document.querySelector('#swaAutonomy');
    if (autonomy) { autonomy.value = ['observer', 'assistant', 'autonomous'].includes(context.autonomy) ? context.autonomy : 'assistant'; autonomy.disabled = !device || state.busy; }

    const pause = document.querySelector('#swaPause');
    if (pause) { pause.textContent = context.paused ? 'Retomar Agent' : 'Pausar Agent'; pause.disabled = !device || state.busy; }

    for (const id of ['#swaEnableAll', '#swaSave', '#swaRefresh']) {
      const el = document.querySelector(id);
      if (el) el.disabled = !device && id !== '#swaRefresh' || state.busy;
    }

    if (state.error) setStatus(state.error, true);
    else if (!device) setStatus('Nenhum PC Agent online. Abra a SEXTA Desktop e confirme o pareamento.');
    else setStatus(`${context.paused ? 'Agent pausado' : 'Agent ativo'} • ${context.autonomy || 'assistant'} • permissões aplicadas localmente.`);
  }

  async function control(op, value) {
    if (!state.device?.device_id) throw new Error('PC Agent offline');
    return api('/api/agent-control', {
      method: 'POST',
      body: JSON.stringify({ targetDeviceId: state.device.device_id, op, ...(value === undefined ? {} : { value }) })
    });
  }

  async function waitForHeartbeat(timeoutMs = 4200) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 450));
      try {
        const sync = await api('/api/sync?fresh=1');
        const pc = pcFromDevices(sync.devices || []);
        if (pc) { state.device = pc; return pc; }
      } catch {}
    }
    return state.device;
  }

  async function withBusy(task, successMessage) {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    try {
      await task();
      await waitForHeartbeat();
      state.lastUpdatedAt = Date.now();
      setStatus(successMessage || 'Configuração aplicada.');
    } catch (error) {
      state.error = String(error?.message || error);
      setStatus(state.error, true);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function enableAll() {
    return withBusy(async () => {
      document.querySelectorAll('[data-swa-privacy]').forEach(input => { input.checked = true; });
      const autonomy = document.querySelector('#swaAutonomy');
      if (autonomy && autonomy.value === 'observer') autonomy.value = 'assistant';
      await control('resume');
      await control('set_privacy', { screen: true, clipboard: true, uiAutomation: true, browser: true, hardware: true });
      await control('set_autonomy', autonomy?.value || 'assistant');
    }, 'Controle completo da interface ativado no PC.');
  }

  async function saveCurrent() {
    return withBusy(async () => {
      const autonomy = document.querySelector('#swaAutonomy')?.value || 'assistant';
      await control('set_privacy', currentPrivacy());
      await control('set_autonomy', autonomy);
    }, 'Permissões do Windows atualizadas.');
  }

  async function togglePause() {
    const paused = state.device?.context?.paused === true;
    return withBusy(() => control(paused ? 'resume' : 'pause'), paused ? 'PC Agent retomado.' : 'PC Agent pausado.');
  }

  async function refresh(force = false) {
    if (!token()) return;
    if (!mount()) { setTimeout(() => void refresh(force), 600); return; }
    try {
      const sync = await api(`/api/sync?fresh=${force ? 1 : 0}`);
      state.device = pcFromDevices(sync.devices || []);
      state.error = '';
      state.lastUpdatedAt = Date.now();
    } catch (error) {
      state.error = String(error?.message || error);
    }
    render();
  }

  window.__sextaWindowsAccess = {
    installed: true,
    version: '1.0.0-explicit-local-access',
    refresh: () => refresh(true),
    enableAll,
    debug: () => ({ ...state, device: state.device ? { device_id: state.device.device_id, name: state.device.name, context: state.device.context } : null })
  };

  const boot = setInterval(() => {
    if (mount()) {
      clearInterval(boot);
      void refresh(true);
    }
  }, 500);
  setTimeout(() => clearInterval(boot), 20000);
  window.addEventListener('sexta:sync-complete', () => void refresh(false));
})();
