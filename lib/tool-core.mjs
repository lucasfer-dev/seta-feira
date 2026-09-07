import { config } from './core.mjs';
import { LIVE_TOOL_DECLARATIONS, executeTool as executeNativeTool } from './tool-bus.mjs';
import { executeMcpTool, getMcpStatus, getMcpToolDeclarations, isMcpToolName } from './mcp-client.mjs';
import { evaluateToolPolicy, toolPolicyVersion } from './tool-policy.mjs';

const TOOL_CORE_VERSION = '1.0.0';

export async function getLiveToolDeclarations() {
  let mcp = [];
  try { mcp = await getMcpToolDeclarations(); }
  catch (error) { console.warn('[SEXTA MCP] discovery unavailable:', error?.message || error); }

  const seen = new Set();
  return [...LIVE_TOOL_DECLARATIONS, ...mcp].filter(tool => {
    const name = String(tool?.name || '');
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export async function executeTool(name, args = {}, options = {}) {
  const userText = String(options.userText || '').trim();
  const enforceExplicit = options.enforceExplicit === true && Boolean(userText);

  if (isMcpToolName(name)) {
    return executeMcpTool(name, args, { userText, enforceExplicit });
  }

  const policy = evaluateToolPolicy(name, args, { userText, enforceExplicit });
  if (!policy.allowed) {
    return {
      ok: false,
      handled: true,
      tool: name,
      state: 'confirmation_required',
      error: policy.reason,
      policy
    };
  }

  const result = await executeNativeTool(name, args, options);
  return result && typeof result === 'object'
    ? { ...result, policy: { risk: policy.risk, sideEffect: policy.sideEffect, version: policy.version } }
    : result;
}

export async function planAndExecuteTools(message, { deviceId = '', maxRounds = 4, requestText = '' } = {}) {
  const c = config();
  if (!c.geminiKey || !String(message || '').trim()) return { handled: false, calls: [], results: [] };
  const model = process.env.GEMINI_TOOL_MODEL || c.geminiModel || 'gemini-3.7-flash';
  const declarations = await getLiveToolDeclarations();
  const contents = [{ role: 'user', parts: [{ text: String(message).trim() }] }];
  const calls = [];
  const results = [];

  for (let round = 0; round < Math.max(1, Math.min(6, maxRounds)); round += 1) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.geminiKey },
      body: JSON.stringify({
        contents,
        tools: [{ functionDeclarations: declarations }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
      }),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GEMINI_TOOL_${response.status}: ${data?.error?.message || 'tool planner failed'}`);
    const content = data?.candidates?.[0]?.content;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    const functionCalls = parts.filter(part => part?.functionCall).map(part => part.functionCall);
    if (!functionCalls.length) {
      return {
        handled: calls.length > 0,
        calls,
        results,
        modelText: parts.map(part => part.text || '').filter(Boolean).join('\n').trim(),
        toolCore: TOOL_CORE_VERSION
      };
    }

    contents.push(content);
    const responseParts = [];
    for (const call of functionCalls) {
      const callName = String(call.name || '');
      const callArgs = call.args && typeof call.args === 'object' ? call.args : {};
      calls.push({ id: call.id || '', name: callName, args: callArgs });
      let result;
      try {
        result = await executeTool(callName, callArgs, {
          deviceId,
          userText: requestText || message,
          enforceExplicit: true
        });
      } catch (error) {
        result = { ok: false, handled: true, state: 'failed', error: String(error?.message || error) };
      }
      results.push({ name: callName, result });
      responseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: callName,
          response: result
        }
      });
    }
    contents.push({ role: 'user', parts: responseParts });
  }

  return { handled: calls.length > 0, calls, results, toolCore: TOOL_CORE_VERSION };
}

export async function getToolCoreStatus() {
  const [declarations, mcp] = await Promise.all([
    getLiveToolDeclarations(),
    getMcpStatus().catch(error => ({ configured: true, servers: [], tools: 0, error: String(error?.message || error) }))
  ]);
  return {
    version: TOOL_CORE_VERSION,
    policyVersion: toolPolicyVersion(),
    nativeTools: LIVE_TOOL_DECLARATIONS.length,
    totalTools: declarations.length,
    mcp
  };
}
