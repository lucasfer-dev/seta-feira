(() => {
  const ownerToken = () => localStorage.getItem('sexta_token') || '';
  const isDesktop = () => Boolean(window.sextaDesktop?.desktop && window.sextaDesktop?.system?.pairAgent);

  function openOwnerLogin(message = 'Entre com o PIN da SEXTA para autorizar o pareamento deste PC.') {
    const dialog = document.querySelector('#loginDialog');
    const input = document.querySelector('#pinInput');
    const pairCode = document.querySelector('#s3PairCode');
    const pairExpiry = document.querySelector('#s3PairExpiry');
    if (pairCode) pairCode.textContent = 'LOGIN';
    if (pairExpiry) pairExpiry.textContent = message;
    if (dialog && !dialog.open) dialog.showModal();
    setTimeout(() => input?.focus(), 50);
  }

  async function pairInstalledDesktop(code) {
    const pairCode = document.querySelector('#s3PairCode');
    const pairExpiry = document.querySelector('#s3PairExpiry');
    if (!isDesktop()) return null;
    if (pairCode) pairCode.textContent = 'PAIR';
    if (pairExpiry) pairExpiry.textContent = 'Pareando este Windows e iniciando o PC Agent…';
    const result = await window.sextaDesktop.system.pairAgent({ code });
    if (!result?.ok) throw new Error(result?.error || 'PAIRING_NATIVE_FAILED');
    if (pairCode) pairCode.textContent = 'OK ✓';
    if (pairExpiry) {
      const extras = [result.browserDetected ? 'Browser' : '', result.vscodeDetected ? 'VS Code' : '', result.codexDetected ? 'Codex' : ''].filter(Boolean).join(' • ');
      pairExpiry.textContent = `PC pareado como ${result.deviceName || 'Windows'}. Agent iniciando${extras ? ` • ${extras}` : ''}.`;
    }
    setTimeout(() => document.querySelector('#s3RefreshBtn')?.click(), 1200);
    setTimeout(() => document.querySelector('#s3RefreshBtn')?.click(), 3500);
    return result;
  }

  async function generatePairingCode(event) {
    const button = event.target?.closest?.('#s3PairReveal');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const pairCode = document.querySelector('#s3PairCode');
    const pairExpiry = document.querySelector('#s3PairExpiry');
    const token = ownerToken();
    if (!token) return openOwnerLogin();

    button.disabled = true;
    if (pairCode) pairCode.textContent = '••••-••••';
    if (pairExpiry) pairExpiry.textContent = 'Gerando código temporário…';

    try {
      const response = await fetch('/api/agent-pair', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        cache: 'no-store'
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        localStorage.removeItem('sexta_token');
        return openOwnerLogin('Sua sessão expirou. Entre novamente e clique em GERAR CÓDIGO.');
      }
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);

      if (isDesktop()) {
        await pairInstalledDesktop(data.code);
        return;
      }

      if (pairCode) pairCode.textContent = data.code || 'ERRO';
      if (pairExpiry) {
        const expires = data.expiresAt ? new Date(data.expiresAt) : null;
        pairExpiry.textContent = expires && !Number.isNaN(expires.getTime())
          ? `Expira às ${expires.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Informe este código no setup do outro PC.`
          : 'Código temporário criado. Informe-o no setup do outro PC.';
      }
    } catch (error) {
      if (pairCode) pairCode.textContent = 'ERRO';
      if (pairExpiry) pairExpiry.textContent = String(error?.message || error);
    } finally {
      button.disabled = false;
    }
  }

  function improveDesktopInstructions() {
    if (!window.sextaDesktop?.desktop) return;
    const card = document.querySelector('#s3PairCode')?.closest('.s3-control-card');
    const intro = card?.querySelector('h3 + p');
    const button = document.querySelector('#s3PairReveal');
    if (intro) intro.innerHTML = 'Clique em <strong>PAREAR ESTE PC</strong>. A SEXTA cria um código temporário, registra este Windows localmente e inicia o PC Agent sem terminal ou npm.';
    if (button) button.textContent = 'PAREAR ESTE PC';
  }

  function openAgentControlFromDesktop() {
    const modal = document.querySelector('.s3-agent-modal');
    if (modal && !modal.open) modal.showModal();
  }

  document.addEventListener('click', generatePairingCode, true);
  window.addEventListener('sexta:open-agent-control', openAgentControlFromDesktop);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', improveDesktopInstructions, { once: true });
  else queueMicrotask(improveDesktopInstructions);
})();
