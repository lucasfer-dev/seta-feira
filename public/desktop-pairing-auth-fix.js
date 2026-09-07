(() => {
  const ownerToken = () => localStorage.getItem('sexta_token') || '';

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

  async function generatePairingCode(event) {
    const button = event.target?.closest?.('#s3PairReveal');
    if (!button) return;

    // The v3 shell had its own fetch path and did not inherit the legacy
    // login-on-401 behavior. Own this click in capture phase so first-contact
    // works consistently inside the installed Electron app.
    event.preventDefault();
    event.stopImmediatePropagation();

    const pairCode = document.querySelector('#s3PairCode');
    const pairExpiry = document.querySelector('#s3PairExpiry');
    const token = ownerToken();
    if (!token) {
      openOwnerLogin();
      return;
    }

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
        openOwnerLogin('Sua sessão expirou. Entre novamente e depois clique em GERAR CÓDIGO.');
        return;
      }
      if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);

      if (pairCode) pairCode.textContent = data.code || 'ERRO';
      if (pairExpiry) {
        const expires = data.expiresAt ? new Date(data.expiresAt) : null;
        pairExpiry.textContent = expires && !Number.isNaN(expires.getTime())
          ? `Expira às ${expires.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}. Abra o menu da SEXTA perto do relógio → Configurar PC Agent… e informe este código.`
          : 'Código temporário criado. Abra o menu da SEXTA perto do relógio → Configurar PC Agent… e informe este código.';
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
    const heading = document.querySelector('#s3PairCode')?.closest('.s3-control-card');
    const intro = heading?.querySelector('h3 + p');
    if (intro) intro.innerHTML = 'Gere um código temporário e depois, no ícone da <strong>SEXTA</strong> perto do relógio do Windows, escolha <strong>Configurar PC Agent…</strong>. O código expira rapidamente e não é o token do agente.';
  }

  document.addEventListener('click', generatePairingCode, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', improveDesktopInstructions, { once: true });
  else queueMicrotask(improveDesktopInstructions);
})();
