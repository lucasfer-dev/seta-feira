import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const doc = fs.readFileSync(new URL('../docs/PC-CONTROL-V2.md', import.meta.url), 'utf8');

test('full PC control keeps credentials and critical actions protected', () => {
  assert.match(doc, /senha/i);
  assert.match(doc, /2FA/i);
  assert.match(doc, /pagamentos/i);
  assert.match(doc, /confirmação explícita/i);
  assert.match(doc, /shell genérico/i);
});
