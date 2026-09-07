(() => {
  document.title = 'SEXTA';
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.content = 'SEXTA — assistente pessoal com voz em tempo real, memória, automações e agentes conectados.';

  const normalize = () => {
    const loginEyebrow = document.querySelector('#loginDialog .eyebrow');
    if (loginEyebrow) loginEyebrow.textContent = 'SEXTA // PERSONAL INTELLIGENCE';
    const guide = document.querySelector('#view-devices .agent-guide code');
    if (guide) guide.textContent = window.sextaDesktop?.desktop ? 'AGENTE → PAREAR ESTE PC' : 'Desktop SEXTA → AGENTE → PAREAR';
    document.querySelectorAll('.s3-brand-copy small').forEach(el => { el.textContent = 'PERSONAL INTELLIGENCE // CORE 04'; });
    document.documentElement.dataset.sextaOperational = '4.1.1';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', normalize, { once: true });
  else queueMicrotask(normalize);
})();
