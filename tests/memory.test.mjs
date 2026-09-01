import test from 'node:test';
import assert from 'node:assert/strict';

import { __test__ } from '../api/live-turn.js';

test('“salva isso” recupera a última afirmação comum', () => {
  const memory = __test__.resolveReferencedMemory([
    { role: 'user', content: 'Meu projeto principal se chama SEXTA.' },
    { role: 'assistant', content: 'Entendido.' }
  ]);
  assert.equal(memory.content, 'Meu projeto principal se chama SEXTA.');
  assert.equal(memory.source, 'explicit_voice_reference');
});

test('pedido de referência não vira a própria memória', () => {
  const memory = __test__.resolveReferencedMemory([
    { role: 'user', content: 'Minha preferência é usar Android primeiro.' },
    { role: 'user', content: 'Salva isso na sua memória.' }
  ]);
  assert.equal(memory.content, 'Minha preferência é usar Android primeiro.');
});

test('extração explícita continua funcionando', () => {
  const memory = __test__.extractLiveMemory('Sexta-feira, guarda na sua memória que prefiro respostas curtas.');
  assert.match(memory.content, /prefiro respostas curtas/i);
});
