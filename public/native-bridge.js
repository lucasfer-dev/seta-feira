(() => {
  const plugin = window.Capacitor?.Plugins?.AssistantBridge || null;
  const isElectron = /Electron/i.test(navigator.userAgent) || Boolean(window.sextaDesktop?.desktop);
  let lastVoiceState = null;

  function escapeHtml(text='') {
    return String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function ensurePanel() {
    const settings = document.querySelector('#view-settings .settings-layout');
    if (!settings || document.querySelector('#deviceCapabilitiesCard')) return;

    const card = document.createElement('div');
    card.id = 'deviceCapabilitiesCard';
    card.className = 'settings-card device-capabilities-card';
    card.innerHTML = `
      <div class="native-cap-head">
        <div>
          <p class="eyebrow">CAPACIDADES DO DISPOSITIVO</p>
          <h3>Permissões e autonomia</h3>
          <small id="nativeCapSummary">Detectando este dispositivo...</small>
        </div>
        <span class="integration-badge" id="nativeCapBadge">web</span>
      </div>
      <div class="native-cap-grid" id="nativeCapGrid"></div>
      <div class="native-cap-actions" id="nativeCapActions"></div>
      <p class="native-cap-note" id="nativeCapNote">A SEXTA só usa acessos habilitados por você. Ações sensíveis ou irreversíveis continuam exigindo confirmação.</p>
    `;
    settings.appendChild(card);
  }

  function row(label, enabled, detail='') {
    return `<div class="native-cap-row"><span>${escapeHtml(label)}</span><b class="${enabled ? 'ok' : ''}">${enabled ? 'ativo' : 'desligado'}</b>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
  }

  function renderWebFallback() {
    ensurePanel();
    const badge = document.querySelector('#nativeCapBadge');
    const summary = document.querySelector('#nativeCapSummary');
    const grid = document.querySelector('#nativeCapGrid');
    const actions = document.querySelector('#nativeCapActions');
    if (!badge || !summary || !grid || !actions) return;

    if (isElectron) {
      badge.textContent = 'Windows'; badge.className = 'integration-badge ok';
      summary.textContent = 'O Desktop/PC Agent oferece capacidades locais com allowlist e confirmação para ações sensíveis.';
      grid.innerHTML = row('Abrir apps e projetos', true) + row('Clipboard', true) + row('Arquivos selecionados', true) + row('Terminal irrestrito', false, 'bloqueado por segurança');
      actions.innerHTML = '';
    } else {
      badge.textContent = 'web'; badge.className = 'integration-badge';
      summary.textContent = 'No navegador, as permissões são limitadas. O APK Android e o app Windows liberam capacidades nativas.';
      grid.innerHTML = row('Microfone', Boolean(navigator.mediaDevices?.getUserMedia)) + row('Notificações', 'Notification' in window && Notification.permission === 'granted') + row('Segundo plano nativo', false) + row('Acesso a apps/arquivos', false);
      actions.innerHTML = '';
    }
  }

  async function refreshAndroid() {
    ensurePanel();
    if (!plugin) return renderWebFallback();
    const badge = document.querySelector('#nativeCapBadge');
    const summary = document.querySelector('#nativeCapSummary');
    const grid = document.querySelector('#nativeCapGrid');
    const actions = document.querySelector('#nativeCapActions');
    if (!badge || !summary || !grid || !actions) return;

    let status = {};
    try { status = await plugin.status(); } catch (error) { console.warn('AssistantBridge status:', error); }
    badge.textContent = 'Android'; badge.className = 'integration-badge ok';
    summary.textContent = status.backgroundActive ? 'SEXTA em segundo plano e pronta para a palavra “Sexta-feira”.' : 'Android conectado. Ative o modo em segundo plano uma vez com o app aberto.';
    grid.innerHTML = [
      row('Microfone', Boolean(status.microphone)),
      row('Notificações do app', Boolean(status.notifications)),
      row('Escuta em segundo plano', Boolean(status.backgroundActive)),
      row('Leitura de notificações', Boolean(status.notificationAccess)),
      row('Câmera', Boolean(status.camera)),
      row('Contatos', Boolean(status.contacts)),
      row('Agenda', Boolean(status.calendar)),
      row('Bluetooth', Boolean(status.bluetooth))
    ].join('');
    actions.innerHTML = `
      <button class="primary-btn" id="nativeBackgroundToggle">${status.backgroundActive ? 'Parar segundo plano' : 'Ativar segundo plano'}</button>
      <button class="secondary-btn" id="nativeCorePermissions">Permissões essenciais</button>
      <button class="secondary-btn" id="nativeExtraPermissions">Permissões extras</button>
      <button class="secondary-btn" id="nativeNotificationAccess">Acesso às notificações</button>
    `;

    document.querySelector('#nativeBackgroundToggle').onclick = async () => {
      try {
        if (status.backgroundActive) await plugin.stopBackgroundAssistant();
        else await plugin.startBackgroundAssistant();
      } catch (error) { console.warn(error); }
      setTimeout(refreshAndroid, 450);
    };
    document.querySelector('#nativeCorePermissions').onclick = async () => {
      try { await plugin.requestPermissions({ capabilities: ['microphone','notifications'] }); } catch (error) { console.warn(error); }
      setTimeout(refreshAndroid, 900);
    };
    document.querySelector('#nativeExtraPermissions').onclick = async () => {
      try { await plugin.requestPermissions({ capabilities: ['camera','contacts','calendar','bluetooth'] }); } catch (error) { console.warn(error); }
      setTimeout(refreshAndroid, 900);
    };
    document.querySelector('#nativeNotificationAccess').onclick = async () => {
      try { await plugin.openNotificationAccessSettings(); } catch (error) { console.warn(error); }
    };
  }

  async function syncVoiceState() {
    if (!plugin) return;
    const active = Boolean(window.__sextaGeminiLive?.active?.());
    if (active === lastVoiceState) return;
    lastVoiceState = active;
    try { await plugin.setConversationActive({ active }); } catch (error) { console.warn('AssistantBridge voice state:', error); }
  }

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(refreshAndroid, 300);
    setInterval(syncVoiceState, 900);
    document.querySelector('[data-view="settings"]')?.addEventListener('click', () => setTimeout(refreshAndroid, 80));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setTimeout(refreshAndroid, 250);
  });

  window.__sextaNativeBridge = { refresh: refreshAndroid };
})();
