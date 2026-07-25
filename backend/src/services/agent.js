// The RWA Outlets chat agent: an LLM tool-use loop over the subgraph MCP server.
//
// The chat route hands us OpenAI-shaped messages; we run an agentic loop,
// dispatching tool calls to the MCP server (src/mcp/subgraph-server.js) which
// runs in-process over an InMemoryTransport. Only assistant text is surfaced —
// tool traffic stays server-side.
//
// Providers (picked from env): OpenAI (OPENAI_API_KEY + OPENAI_MODEL)
// preferred; Groq (GROQ_API_KEY + GROQ_MODEL) next; Anthropic
// (ANTHROPIC_API_KEY) as fallback. OpenAI and Groq share the same
// chat-completions wire format, so they run through one loop.

const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { Client: McpClient } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { server: subgraphServer } = require('../mcp/subgraph-server');
const env = require('../env');

const PROVIDER = env.OPENAI_API_KEY ? 'openai'
  : env.GROQ_API_KEY ? 'groq'
    : env.ANTHROPIC_API_KEY ? 'anthropic' : null;
const MODEL = PROVIDER === 'openai' ? env.OPENAI_MODEL
  : PROVIDER === 'groq' ? env.GROQ_MODEL : env.ANTHROPIC_MODEL;
const MAX_TOOL_ITERATIONS = 10;

// A run must finish inside the caller's time budget (the nginx ingress kills
// upstreams at ~60s, so non-streaming requests get a deadline below that).
function timeLeft(deadline) {
  return deadline - Date.now();
}

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Aborts a run when the same tool keeps failing the same way (e.g. subgraph
// auth misconfig) instead of letting the model spin through every iteration.
function makeToolFailureTracker() {
  const counts = new Map();
  return (toolName, errorText) => {
    const key = `${toolName}|${errorText.slice(0, 160)}`;
    const n = (counts.get(key) || 0) + 1;
    counts.set(key, n);
    if (n >= 2) {
      throw makeError(
        'SUBGRAPH_TOOL_ERROR',
        `The subgraph tools keep failing: ${errorText.slice(0, 300)}`,
      );
    }
  };
}

// Stable system prompt — no timestamps or per-request content, so providers
// with prompt caching keep a byte-identical prefix.
const SYSTEM_PROMPT = `You are the RWA Outlets analyst — the AI assistant for RWA Outlets, an instant-liquidity market for tokenized real-world assets (RWAs).

Your only source of chain state is the RWA Outlets subgraph (The Graph), reached through two tools:
- get_subgraph_schema: returns the full GraphQL SDL of the deployed subgraph
- query_subgraph: executes a GraphQL query against it

The schema returned by get_subgraph_schema is the source of truth for what is indexed — call it before writing your first query in a conversation, and again whenever a query errors with an unknown field. Typical entities include swaps/trades, redemptions and redemption queues, NAV updates, deposits/withdrawals, vault positions, and KYC events.

Conventions when interpreting data:
- USDC amounts have 6 decimals; RWA token amounts 18 decimals; NAV values are fixed-point 1e18 (1e18 = 1.00 USDC per token)
- Rates vs NAV are in basis points: -250 bps means 2.5% below NAV
- Timestamps are unix seconds
- Always bound queries with \`first:\` (25 is a good default) and use \`orderBy\`/\`orderDirection\` for recency

How to answer:
- Query the subgraph for anything about live state — never invent numbers. If a query errors, fetch the schema and fix it.
- Convert raw values to human units in your answers (e.g. "1,250.50 USDC", "NAV 1.0012", "-250 bps ≈ 2.5% below NAV").
- Be concise and lead with the answer; include the key figures that support it. Mention the query approach only if the user asks.
- If the subgraph genuinely has no data for a question, say so plainly.`;

// ---------------------------------------------------------------- MCP client

let mcpPromise = null;

// The MCP server lives in this same process — client and server are wired
// through an in-memory transport pair, so no child process and no port.
async function connectMcp() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await subgraphServer.connect(serverTransport);

  const client = new McpClient({ name: 'rwa-outlets-backend', version: '1.0.0' });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  // Sorted + stable shape → deterministic tools block → prompt cache hits.
  const mcpTools = tools
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`[agent] MCP connected (in-process) — tools: ${mcpTools.map((t) => t.name).join(', ')}`);
  return { client, tools: mcpTools };
}

function getMcp() {
  if (!mcpPromise) {
    mcpPromise = connectMcp().catch((err) => {
      mcpPromise = null;
      throw err;
    });
  }
  return mcpPromise;
}

async function callMcpTool(name, input) {
  const { client } = await getMcp();
  try {
    const result = await client.callTool({ name, arguments: input || {} });
    const text = (result.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return { text: text || '(empty result)', isError: Boolean(result.isError) };
  } catch (err) {
    return { text: `Tool ${name} failed: ${err.message}`, isError: true };
  }
}

// ------------------------------------------------------------ message shaping

// Normalize OpenAI-style messages. Client-sent system messages are appended
// after our own system prompt; tool-role messages are dropped (tool use is
// entirely server-side here).
function normalizeMessages(openaiMessages) {
  const extraSystem = [];
  const turns = [];
  for (const m of openaiMessages || []) {
    const content = typeof m.content === 'string'
      ? m.content
      : (m.content || [])
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
    if (!content) continue;
    if (m.role === 'system') extraSystem.push(content);
    else if (m.role === 'user' || m.role === 'assistant') turns.push({ role: m.role, content });
  }
  if (turns.length === 0 || turns[0].role !== 'user') {
    turns.unshift({ role: 'user', content: 'Hello' });
  }
  return { extraSystem, turns };
}

// ------------------------------------- OpenAI-style loop (OpenAI and Groq)

let groqClient = null;
let openaiClient = null;

function getOpenAIStyleClient() {
  if (PROVIDER === 'openai') {
    if (!openaiClient) openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    return openaiClient;
  }
  if (!groqClient) groqClient = new Groq({ apiKey: env.GROQ_API_KEY });
  return groqClient;
}

// Free-tier Groq enforces small tokens-per-minute budgets and counts
// max_completion_tokens toward request size — keep the cap modest and retry
// once the window resets when we trip the limit mid-loop. OpenAI reasoning
// models spend hidden tokens from the same budget, so they get more headroom.
const GROQ_MAX_COMPLETION_TOKENS = Number(process.env.GROQ_MAX_COMPLETION_TOKENS || 2048);
const OPENAI_MAX_COMPLETION_TOKENS = Number(process.env.OPENAI_MAX_COMPLETION_TOKENS || 8192);

async function createWithRetry(client, params, deadline, attempts = 3) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.chat.completions.create(params);
    } catch (err) {
      // A quota-exhausted 429 is permanent until billing changes — never retry.
      const quotaDead = err.code === 'insufficient_quota'
        || err.error?.code === 'insufficient_quota';
      const rateLimited = (err.status === 429 || err.status === 413) && !quotaDead;
      // Groq occasionally 400s when the model emits malformed tool-call JSON.
      const flakyToolCall = err.status === 400
        && /tool_use_failed|failed_generation|parse tool call/i.test(
          JSON.stringify(err.error || {}) + err.message,
        );
      if (!(rateLimited || flakyToolCall) || attempt >= attempts) throw err;
      const retryAfter = rateLimited
        ? (Number(err.headers?.get?.('retry-after')) || 10) : 1;
      const waitMs = Math.min(retryAfter, 30) * 1000;
      // Never wait past the run's deadline — fail now with the real error.
      if (waitMs + 2000 > timeLeft(deadline)) throw err;
      console.log(`[agent] ${PROVIDER} rate-limited, retrying in ${waitMs / 1000}s (attempt ${attempt}/${attempts})`);
      await new Promise((r) => { setTimeout(r, waitMs); });
    }
  }
}

async function runOpenAIStyle(openaiMessages, onTextDelta, deadline) {
  const client = getOpenAIStyleClient();
  const { tools } = await getMcp();
  const { extraSystem, turns } = normalizeMessages(openaiMessages);

  const messages = [
    { role: 'system', content: [SYSTEM_PROMPT, ...extraSystem].join('\n\n') },
    ...turns,
  ];
  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const usage = { input_tokens: 0, output_tokens: 0 };
  const collected = [];
  const trackToolFailure = makeToolFailureTracker();
  // Qwen/QwQ/DeepSeek on Groq are reasoning models — keep <think> out of output.
  // (Groq-only knob; OpenAI rejects unknown params.)
  const extras = PROVIDER === 'groq'
    ? (/qwen|qwq|deepseek|r1|gpt-oss/i.test(MODEL) ? { reasoning_format: 'hidden' } : {})
    // OpenAI streams include usage only when asked.
    : { stream_options: { include_usage: true } };
  const maxCompletionTokens = PROVIDER === 'groq'
    ? GROQ_MAX_COMPLETION_TOKENS : OPENAI_MAX_COMPLETION_TOKENS;
  let streamRetries = 0;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    if (timeLeft(deadline) < 3000) {
      if (collected.length) return { text: collected.join('\n\n'), usage, stopReason: 'timeout' };
      throw makeError('AGENT_TIMEOUT', 'Ran out of time before producing an answer');
    }
    const stream = await createWithRetry(client, {
      model: MODEL,
      messages,
      tools: openaiTools,
      max_completion_tokens: maxCompletionTokens,
      stream: true,
      ...extras,
    }, deadline);

    let content = '';
    let finishReason = null;
    const toolCalls = [];
    let firstDeltaOfTurn = true;

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices && chunk.choices[0];
        if (choice) {
          const delta = choice.delta || {};
          if (delta.content) {
            if (onTextDelta) {
              if (firstDeltaOfTurn && collected.length > 0) onTextDelta('\n\n');
              firstDeltaOfTurn = false;
              onTextDelta(delta.content);
            }
            content += delta.content;
          }
          for (const tc of delta.tool_calls || []) {
            const slot = toolCalls[tc.index] || (toolCalls[tc.index] = { id: '', name: '', arguments: '' });
            if (tc.id) slot.id = tc.id;
            if (tc.function && tc.function.name) slot.name += tc.function.name;
            if (tc.function && tc.function.arguments) slot.arguments += tc.function.arguments;
          }
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
        const u = (chunk.x_groq && chunk.x_groq.usage) || chunk.usage;
        if (u) {
          usage.input_tokens += u.prompt_tokens || 0;
          usage.output_tokens += u.completion_tokens || 0;
        }
      }
    } catch (err) {
      // Groq aborts the SSE stream mid-generation when the model emits
      // malformed tool-call JSON (in-band error, no HTTP status). Re-issue
      // the turn — but only if no text streamed yet, so clients never see
      // duplicated output.
      const flakyGeneration = /parse tool call|tool_use_failed|failed_generation/i
        .test(err.message || '');
      if (flakyGeneration && !content && streamRetries < 2 && timeLeft(deadline) > 5000) {
        streamRetries += 1;
        console.log(`[agent] ${PROVIDER} stream flaked mid-generation, retrying turn (${streamRetries}/2)`);
        continue;
      }
      throw err;
    }

    if (content) collected.push(content);

    const calls = toolCalls.filter(Boolean);
    if (finishReason === 'tool_calls' && calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          // Models sometimes emit "" for no-arg tools; echoing that back makes
          // the API reject the transcript as unparseable JSON.
          function: { name: c.name, arguments: c.arguments && c.arguments.trim() ? c.arguments : '{}' },
        })),
      });
      for (const call of calls) {
        console.log(`[agent] tool ${call.name}`);
        let input = {};
        try { input = call.arguments ? JSON.parse(call.arguments) : {}; } catch { /* leave {} */ }
        const { text, isError } = await callMcpTool(call.name, input);
        if (isError) trackToolFailure(call.name, text);
        messages.push({ role: 'tool', tool_call_id: call.id, content: text });
      }
      continue;
    }

    return {
      text: collected.join('\n\n'),
      usage,
      stopReason: finishReason === 'length' ? 'max_tokens' : 'end_turn',
    };
  }

  return { text: collected.join('\n\n'), usage, stopReason: 'max_iterations' };
}

// ---------------------------------------------------------------- Anthropic

let anthropicClient = null;

async function runClaude(openaiMessages, onTextDelta, deadline) {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const { tools } = await getMcp();
  const { extraSystem, turns } = normalizeMessages(openaiMessages);

  const system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ...extraSystem.map((text) => ({ type: 'text', text })),
  ];
  const messages = [...turns];

  const usage = { input_tokens: 0, output_tokens: 0 };
  const collected = [];
  const trackToolFailure = makeToolFailureTracker();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i += 1) {
    if (timeLeft(deadline) < 3000) {
      if (collected.length) return { text: collected.join('\n\n'), usage, stopReason: 'timeout' };
      throw makeError('AGENT_TIMEOUT', 'Ran out of time before producing an answer');
    }
    const stream = anthropicClient.beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools,
      messages,
      // Safety classifiers can decline a request on this model tier; the
      // server-side fallback re-runs it on Anthropic's recommended model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (onTextDelta) {
      let firstDeltaOfTurn = true;
      stream.on('text', (delta) => {
        // Blank line between the narration of consecutive turns.
        if (firstDeltaOfTurn && collected.length > 0) onTextDelta('\n\n');
        firstDeltaOfTurn = false;
        onTextDelta(delta);
      });
    }

    const response = await stream.finalMessage();
    usage.input_tokens += response.usage.input_tokens || 0;
    usage.output_tokens += response.usage.output_tokens || 0;

    for (const block of response.content) {
      if (block.type === 'text' && block.text) collected.push(block.text);
    }

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const results = [];
      for (const tu of toolUses) {
        console.log(`[agent] tool ${tu.name}`);
        const { text, isError } = await callMcpTool(tu.name, tu.input);
        if (isError) trackToolFailure(tu.name, text);
        results.push({
          type: 'tool_result', tool_use_id: tu.id, content: text, is_error: isError,
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    if (response.stop_reason === 'refusal') {
      const note = 'I can’t help with that request.';
      if (onTextDelta && collected.length === 0) onTextDelta(note);
      return { text: collected.join('\n\n') || note, usage, stopReason: 'refusal' };
    }

    // end_turn / max_tokens — done.
    return { text: collected.join('\n\n'), usage, stopReason: response.stop_reason };
  }

  return { text: collected.join('\n\n'), usage, stopReason: 'max_iterations' };
}

// ------------------------------------------------------------------ dispatch

// Runs the full tool-use loop. onTextDelta (optional) receives assistant text
// as it streams; timeBudgetMs bounds the whole run (default 50s — under the
// ingress's ~60s upstream timeout). Resolves with { text, usage, stopReason }.
async function runAgent(openaiMessages, onTextDelta, timeBudgetMs) {
  if (!PROVIDER) {
    throw makeError('AGENT_NOT_CONFIGURED', 'No chat provider configured (set OPENAI_API_KEY, GROQ_API_KEY, or ANTHROPIC_API_KEY)');
  }
  const budget = timeBudgetMs || Number(process.env.AGENT_TIME_BUDGET_MS || 50_000);
  const deadline = Date.now() + budget;
  return PROVIDER === 'anthropic'
    ? runClaude(openaiMessages, onTextDelta, deadline)
    : runOpenAIStyle(openaiMessages, onTextDelta, deadline);
}

module.exports = { runAgent, MODEL, PROVIDER };
