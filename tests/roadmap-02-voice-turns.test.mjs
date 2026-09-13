import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const core = fs.readFileSync(new URL('../public/voice-core-v10.js', import.meta.url), 'utf8');
const guard = fs.readFileSync(new URL('../public/voice-barge-in-guard.js', import.meta.url), 'utf8');
const token = fs.readFileSync(new URL('../api/live-token.js', import.meta.url), 'utf8');
test('voice requires wake per command while preserving wake+command in one utterance', () => {
  assert.doesNotMatch(core, /A sessão é contínua/);
  assert.match(core, /cada novo comando exige a wake word local/);
  assert.match(guard, /WAKE_COMMAND_WINDOW_MS = 7000/);
  assert.match(guard, /WAKE_REARM_GUARD_MS = 350/);
  assert.match(token, /Não faça preâmbulo antes de ferramenta/);
});
