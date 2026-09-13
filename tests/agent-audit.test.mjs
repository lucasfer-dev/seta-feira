import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sexta-audit-test-'));
const auditFile = path.join(root, 'nested', 'agent-audit.log');
process.env.SEXTA_AGENT_AUDIT = auditFile;
process.env.SEXTA_AGENT_AUDIT_MAX_BYTES = '262144';
const auditModule = await import(`../agent/audit.mjs?test=${Date.now()}`);

test.after(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  delete process.env.SEXTA_AGENT_AUDIT;
  delete process.env.SEXTA_AGENT_AUDIT_MAX_BYTES;
});

test('audit grava JSONL em diretório criado automaticamente', () => {
  const result = auditModule.audit({
    commandId: 'cmd-1',
    action: 'window_focus',
    status: 'done',
    ok: true,
    details: { hwnd: 123, title: 'Editor' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.path, auditFile);
  const rows = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].commandId, 'cmd-1');
  assert.equal(rows[0].details.hwnd, 123);
  assert.equal(rows[0].details.title, 'Editor');
  assert.equal(typeof rows[0].pid, 'number');
});

test('audit remove segredos e suporta estruturas circulares', () => {
  const circular = { safe: 'ok', password: '123', nested: { authorization: 'Bearer secret' } };
  circular.self = circular;
  const result = auditModule.audit({
    commandId: 'cmd-2',
    action: 'copy_text',
    status: 'failed',
    ok: false,
    details: { message: 'falhou', clipboard: 'conteúdo privado', circular }
  });

  assert.equal(result.ok, true);
  const rows = fs.readFileSync(auditFile, 'utf8').trim().split('\n').map(JSON.parse);
  const row = rows.at(-1);
  assert.equal(row.details.message, 'falhou');
  assert.equal(row.details.clipboard, '[redacted]');
  assert.equal(row.details.circular.password, '[redacted]');
  assert.equal(row.details.circular.nested.authorization, '[redacted]');
  assert.equal(row.details.circular.self, '[circular]');
});
