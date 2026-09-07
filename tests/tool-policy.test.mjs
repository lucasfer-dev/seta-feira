import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateToolPolicy, getToolPolicy } from '../lib/tool-policy.mjs';

test('read tools do not require explicit action', () => {
  const policy = evaluateToolPolicy('memory_list', {}, { enforceExplicit: true, userText: 'o que voce lembra de mim?' });
  assert.equal(policy.allowed, true);
  assert.equal(policy.sideEffect, 'read');
});

test('message sending is blocked when the model invents the side effect', () => {
  const policy = evaluateToolPolicy('whatsapp_send_message', { recipient: 'Gabriel', text: 'oi' }, {
    enforceExplicit: true,
    userText: 'quem e o Gabriel?'
  });
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, 'EXPLICIT_USER_ACTION_REQUIRED');
});

test('message sending is allowed after an explicit user command', () => {
  const policy = evaluateToolPolicy('whatsapp_send_message', { recipient: 'Gabriel', text: 'oi' }, {
    enforceExplicit: true,
    userText: 'manda uma mensagem no whatsapp para o Gabriel dizendo oi'
  });
  assert.equal(policy.allowed, true);
});

test('codex edit is classified as high risk code write', () => {
  const policy = getToolPolicy('pc_codex_task', { mode: 'edit' });
  assert.equal(policy.risk, 'high');
  assert.equal(policy.sideEffect, 'code-write');
});

test('destructive MCP tools are disabled by default', () => {
  const previous = process.env.SEXTA_MCP_ALLOW_DESTRUCTIVE;
  delete process.env.SEXTA_MCP_ALLOW_DESTRUCTIVE;
  const policy = evaluateToolPolicy('mcp_home_delete_everything_abcd12', {}, {
    externalTool: { annotations: { destructiveHint: true } }
  });
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, 'MCP_DESTRUCTIVE_TOOL_DISABLED');
  if (previous === undefined) delete process.env.SEXTA_MCP_ALLOW_DESTRUCTIVE;
  else process.env.SEXTA_MCP_ALLOW_DESTRUCTIVE = previous;
});
