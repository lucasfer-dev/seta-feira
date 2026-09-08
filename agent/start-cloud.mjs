import { fileURLToPath } from 'node:url';

process.env.SEXTA_BASE_URL ||= 'https://seta-feira.vercel.app';
process.env.SEXTA_AGENT_CONFIG ||= fileURLToPath(new URL('./config.json', import.meta.url));
await import('./vision-fallback.mjs');
await import('./agent-v3.mjs');
