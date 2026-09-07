import { evaluateToolPolicy } from './tool-policy.mjs';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const DEFAULT_TIMEOUT_MS = 4000;
const DISCOVERY_TTL_MS = 60_000;
const MAX_MCP_TOOLS = 64;
const discoveryCache = new Map();
let rpcId = 1;

function safeId(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20) || 'server';
}

function hashString(value = '') {
  let hash = 0x811c9dc5;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

export function mcpToolAlias(serverId, toolName) {
  const prefix = `mcp_${safeId(serverId)}_`;
  const cleaned = String(toolName || '').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
  const suffix = `_${hashString(toolName)}`;
  return `${prefix}${cleaned.slice(0, Math.max(1, 63 - prefix.length - suffix.length))}${suffix}`;
}

function validHttpUrl(value = '') {
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function parseMcpServers(raw = process.env.SEXTA_MCP_SERVERS || '') {
  const source = String(raw || '').trim();
  if (!source) return [];
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { return []; }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const seen = new Set();
  return list.map((item, index) => {
    if (!item || typeof item !== 'object' || item.enabled === false) return null;
    const url = validHttpUrl(item.url);
    if (!url) return null;
    const id = safeId(item.id || item.name || `mcp_${index + 1}`);
    if (seen.has(id)) return null;
    seen.add(id);
    return {
      id,
      url,
      authorizationEnv: String(item.authorizationEnv || '').trim(),
      headersEnv: String(item.headersEnv || '').trim(),
      timeoutMs: Math.max(1000, Math.min(12000, Number(item.timeoutMs) || DEFAULT_TIMEOUT_MS))
    };
  }).filter(Boolean);
}

function resolveHeaders(server, sessionId = '') {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  if (server.authorizationEnv) {
    const secret = String(process.env[server.authorizationEnv] || '').trim();
    if (secret) headers.authorization = /^Bearer\s/i.test(secret) ? secret : `Bearer ${secret}`;
  }
  if (server.headersEnv) {
    try {
      const extra = JSON.parse(String(process.env[server.headersEnv] || '{}'));
      for (const [key, value] of Object.entries(extra || {})) {
        const normalized = String(key || '').toLowerCase();
        if (!normalized || ['host', 'content-length', 'connection'].includes(normalized)) continue;
        headers[normalized] = String(value);
      }
    } catch {}
  }
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return headers;
}

function decodeRpcPayload(text = '', contentType = '') {
  const source = String(text || '').trim();
  if (!source) return {};
  if (/text\/event-stream/i.test(contentType) || source.startsWith('event:') || source.startsWith('data:')) {
    const candidates = source.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean);
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(candidates[index]); } catch {}
    }
    return {};
  }
  try { return JSON.parse(source); } catch { return {}; }
}

async function rpc(server, method, params = {}, { sessionId = '', notification = false } = {}) {
  const id = notification ? undefined : rpcId++;
  const body = { jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params };
  const response = await fetch(server.url, {
    method: 'POST',
    headers: resolveHeaders(server, sessionId),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(server.timeoutMs || DEFAULT_TIMEOUT_MS)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP_HTTP_${response.status}`);
  const payload = decodeRpcPayload(text, response.headers.get('content-type') || '');
  if (payload?.error) throw new Error(`MCP_RPC_${payload.error.code || 'ERROR'}: ${payload.error.message || 'request failed'}`);
  return {
    payload,
    sessionId: response.headers.get('mcp-session-id') || sessionId || ''
  };
}

async function initialize(server) {
  const initialized = await rpc(server, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'sexta-feira', version: '3.2-tool-core' }
  });
  const sessionId = initialized.sessionId;
  try { await rpc(server, 'notifications/initialized', {}, { sessionId, notification: true }); } catch {}
  return sessionId;
}

async function discoverServer(server, { force = false } = {}) {
  const cached = discoveryCache.get(server.id);
  if (!force && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
  const sessionId = await initialize(server);
  const listed = await rpc(server, 'tools/list', {}, { sessionId });
  const tools = Array.isArray(listed.payload?.result?.tools) ? listed.payload.result.tools.slice(0, MAX_MCP_TOOLS) : [];
  const value = tools.map(tool => ({
    server,
    remoteName: String(tool?.name || ''),
    alias: mcpToolAlias(server.id, tool?.name || ''),
    description: String(tool?.description || '').slice(0, 900),
    inputSchema: tool?.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} },
    annotations: tool?.annotations && typeof tool.annotations === 'object' ? tool.annotations : {}
  })).filter(tool => tool.remoteName);
  discoveryCache.set(server.id, { at: Date.now(), value });
  return value;
}

export async function listMcpTools(options = {}) {
  const servers = parseMcpServers();
  if (!servers.length) return [];
  const settled = await Promise.allSettled(servers.map(server => discoverServer(server, options)));
  return settled.flatMap(item => item.status === 'fulfilled' ? item.value : []);
}

export async function getMcpToolDeclarations() {
  const tools = await listMcpTools();
  return tools.map(tool => ({
    name: tool.alias,
    description: `[MCP:${tool.server.id}] ${tool.description || tool.remoteName}`.slice(0, 1024),
    parameters: tool.inputSchema
  }));
}

export function isMcpToolName(name = '') {
  return String(name || '').startsWith('mcp_');
}

export async function executeMcpTool(alias, args = {}, context = {}) {
  const tools = await listMcpTools({ force: false });
  const tool = tools.find(item => item.alias === alias);
  if (!tool) throw new Error('MCP_TOOL_NOT_FOUND');

  const policy = evaluateToolPolicy(alias, args, {
    ...context,
    externalTool: { annotations: tool.annotations }
  });
  if (!policy.allowed) {
    return {
      ok: false,
      handled: true,
      scope: `mcp:${tool.server.id}`,
      state: 'confirmation_required',
      error: policy.reason,
      policy
    };
  }

  const sessionId = await initialize(tool.server);
  const called = await rpc(tool.server, 'tools/call', { name: tool.remoteName, arguments: args || {} }, { sessionId });
  const result = called.payload?.result ?? {};
  return {
    ok: result?.isError !== true,
    handled: true,
    scope: `mcp:${tool.server.id}`,
    state: result?.isError === true ? 'failed' : 'completed',
    result,
    policy,
    tool: alias
  };
}

export async function getMcpStatus() {
  const servers = parseMcpServers();
  if (!servers.length) return { configured: false, servers: [], tools: 0 };
  const statuses = await Promise.all(servers.map(async server => {
    try {
      const tools = await discoverServer(server);
      return { id: server.id, configured: true, online: true, tools: tools.length };
    } catch (error) {
      return { id: server.id, configured: true, online: false, tools: 0, error: String(error?.message || error).slice(0, 180) };
    }
  }));
  return { configured: true, servers: statuses, tools: statuses.reduce((sum, item) => sum + item.tools, 0) };
}
