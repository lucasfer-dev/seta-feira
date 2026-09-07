(() => {
  if (window.__sextaPresenceOrb?.installed) return;
  const voiceBtn = document.querySelector('#voiceBtn');
  if (!voiceBtn) return;

  voiceBtn.classList.add('sexta-presence-orb');
  const style = document.createElement('style');
  style.dataset.sextaPresenceOrb = '1';
  style.textContent = `
    #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 103,232,249;
      --sexta-orb-energy: .42;
      position: relative;
      isolation: isolate;
      overflow: visible;
    }
    #voiceBtn.sexta-presence-orb::before,
    #voiceBtn.sexta-presence-orb::after {
      content: '';
      position: absolute;
      pointer-events: none;
      border-radius: 50%;
      inset: -10px;
      z-index: -1;
      opacity: .28;
      transition: opacity .22s ease, transform .22s ease, border-color .22s ease, filter .22s ease;
    }
    #voiceBtn.sexta-presence-orb::before {
      border: 1px solid rgba(var(--sexta-orb-rgb), .38);
      box-shadow:
        0 0 20px rgba(var(--sexta-orb-rgb), calc(var(--sexta-orb-energy) * .34)),
        inset 0 0 16px rgba(var(--sexta-orb-rgb), .06);
    }
    #voiceBtn.sexta-presence-orb::after {
      inset: -20px;
      border: 1px dashed rgba(var(--sexta-orb-rgb), .22);
      filter: drop-shadow(0 0 8px rgba(var(--sexta-orb-rgb), .18));
    }

    html[data-sexta-presence='standby'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 148,163,184;
      --sexta-orb-energy: .20;
    }
    html[data-sexta-presence='standby'] #voiceBtn.sexta-presence-orb::before { transform: scale(.94); opacity: .16; }
    html[data-sexta-presence='standby'] #voiceBtn.sexta-presence-orb::after { transform: scale(.96); opacity: .08; }

    html[data-sexta-presence='listening'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 103,232,249;
      --sexta-orb-energy: .68;
    }
    html[data-sexta-presence='listening'] #voiceBtn.sexta-presence-orb::before {
      opacity: .72;
      animation: sexta-orb-breathe 1.65s ease-in-out infinite;
    }
    html[data-sexta-presence='listening'] #voiceBtn.sexta-presence-orb::after {
      opacity: .38;
      animation: sexta-orb-spin 7s linear infinite;
    }

    html[data-sexta-presence='thinking'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 167,139,250;
      --sexta-orb-energy: .72;
    }
    html[data-sexta-presence='thinking'] #voiceBtn.sexta-presence-orb::before {
      opacity: .72;
      animation: sexta-orb-think 1.1s ease-in-out infinite;
    }
    html[data-sexta-presence='thinking'] #voiceBtn.sexta-presence-orb::after {
      opacity: .62;
      animation: sexta-orb-spin 2.6s linear infinite reverse;
    }

    html[data-sexta-presence='speaking'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 34,211,238;
      --sexta-orb-energy: .92;
    }
    html[data-sexta-presence='speaking'] #voiceBtn.sexta-presence-orb::before {
      opacity: .94;
      animation: sexta-orb-speak .62s ease-in-out infinite alternate;
    }
    html[data-sexta-presence='speaking'] #voiceBtn.sexta-presence-orb::after {
      opacity: .55;
      animation: sexta-orb-spin 4.4s linear infinite;
    }

    html[data-sexta-presence='acting'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 251,191,36;
      --sexta-orb-energy: .86;
    }
    html[data-sexta-presence='acting'] #voiceBtn.sexta-presence-orb::before {
      opacity: .88;
      animation: sexta-orb-act .82s cubic-bezier(.22,.9,.3,1) infinite;
    }
    html[data-sexta-presence='acting'] #voiceBtn.sexta-presence-orb::after {
      opacity: .70;
      animation: sexta-orb-spin 1.9s linear infinite;
    }

    html[data-sexta-presence='reconnecting'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 56,189,248;
      --sexta-orb-energy: .54;
    }
    html[data-sexta-presence='reconnecting'] #voiceBtn.sexta-presence-orb::before,
    html[data-sexta-presence='reconnecting'] #voiceBtn.sexta-presence-orb::after {
      opacity: .46;
      animation: sexta-orb-reconnect 1.05s steps(4,end) infinite;
    }

    html[data-sexta-presence='error'] #voiceBtn.sexta-presence-orb {
      --sexta-orb-rgb: 248,113,113;
      --sexta-orb-energy: .72;
    }
    html[data-sexta-presence='error'] #voiceBtn.sexta-presence-orb::before {
      opacity: .82;
      animation: sexta-orb-error .48s ease-in-out 3;
    }
    html[data-sexta-presence='error'] #voiceBtn.sexta-presence-orb::after { opacity: .38; }

    @keyframes sexta-orb-breathe { 0%,100% { transform: scale(.97); } 50% { transform: scale(1.08); } }
    @keyframes sexta-orb-spin { to { transform: rotate(360deg); } }
    @keyframes sexta-orb-think { 0%,100% { transform: scale(.96) rotate(-4deg); } 50% { transform: scale(1.07) rotate(4deg); } }
    @keyframes sexta-orb-speak { from { transform: scale(.96); } to { transform: scale(1.13); } }
    @keyframes sexta-orb-act { 0%,100% { transform: scale(.98); } 38% { transform: scale(1.10); } 52% { transform: scale(1.02); } }
    @keyframes sexta-orb-reconnect { 0%,100% { transform: rotate(0deg) scale(.98); } 50% { transform: rotate(180deg) scale(1.04); } }
    @keyframes sexta-orb-error { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }

    @media (prefers-reduced-motion: reduce) {
      #voiceBtn.sexta-presence-orb::before,
      #voiceBtn.sexta-presence-orb::after { animation: none !important; }
    }
  `;
  document.head.appendChild(style);

  window.__sextaPresenceOrb = {
    installed: true,
    version: '1.0.0',
    debug: () => ({ presence: document.documentElement.dataset.sextaPresence || 'standby' })
  };
})();
