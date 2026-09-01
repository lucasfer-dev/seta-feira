import test from 'node:test';
import assert from 'node:assert/strict';

import { __test__, checkLoginRate, clearLoginFailures, recordLoginFailure, secureStringEqual } from '../lib/login-rate-limit.mjs';

test('bloqueia depois de cinco PINs incorretos', () => {
  const key = 'login-test';
  clearLoginFailures(key);
  for (let attempt = 0; attempt < __test__.MAX_FAILURES; attempt++) recordLoginFailure(key, 1_000);
  const blocked = checkLoginRate(key, 1_000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  clearLoginFailures(key);
});

test('comparação do PIN não depende do tamanho', () => {
  assert.equal(secureStringEqual('1234', '1234'), true);
  assert.equal(secureStringEqual('1234', '12345'), false);
});
