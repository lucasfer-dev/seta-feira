import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SEXTA_SERVER_SECRET = 'test-secret-for-agent-pairing-123';
const auth = await import(`../lib/agent-auth.mjs?test=${Date.now()}`);

test('pairing code atual é aceito e código errado é rejeitado', () => {
  const pair = auth.currentPairingCode(1_800_000);
  assert.match(pair.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(auth.verifyPairingCode(pair.code, 1_800_000), true);
  assert.equal(auth.verifyPairingCode('AAAA-AAAA', 1_800_000), false);
});

test('token pareado fica preso ao deviceId', () => {
  const token = auth.issueAgentToken('windows-lab', Date.now());
  assert.equal(auth.verifyAgentToken(token, 'windows-lab')?.deviceId, 'windows-lab');
  assert.equal(auth.verifyAgentToken(token, 'windows-outro'), null);
  assert.equal(auth.verifyAgentToken(`${token}x`, 'windows-lab'), null);
});
