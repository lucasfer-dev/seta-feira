import test from 'node:test';
import assert from 'node:assert/strict';
import { mcpToolAlias, parseMcpServers } from '../lib/mcp-client.mjs';

test('MCP aliases are deterministic and Gemini-safe', () => {
  const first = mcpToolAlias('Home Assistant', 'lights.turn-on');
  const second = mcpToolAlias('Home Assistant', 'lights.turn-on');
  assert.equal(first, second);
  assert.match(first, /^[a-zA-Z0-9_]+$/);
  assert.ok(first.length <= 63);
});

test('MCP server parsing ignores invalid and disabled entries', () => {
  const parsed = parseMcpServers(JSON.stringify([
    { id: 'home', url: 'https://example.com/mcp' },
    { id: 'off', url: 'https://example.com/off', enabled: false },
    { id: 'bad', url: 'file:///tmp/mcp' }
  ]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'home');
});
