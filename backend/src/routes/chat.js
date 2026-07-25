// OpenAI-compatible chat facade over the subgraph agent.
//
// The frontend talks standard OpenAI wire format (point any OpenAI client at
// baseURL `<backend>/api/v1`); behind it, Claude runs a tool-use loop against
// the subgraph MCP server. Tool traffic is never exposed to the client —
// only assistant text streams out.
//
//   POST /api/v1/chat/completions   { model?, messages, stream? }
//   GET  /api/v1/models

const express = require('express');
const { runAgent, MODEL } = require('../services/agent');

const router = express.Router();

const completionId = () => `chatcmpl-${Math.random().toString(36).slice(2, 14)}`;

// The nginx ingress kills idle/slow upstreams around 60s. Non-streaming
// responses must finish inside that; streaming connections stay alive via
// SSE keepalives, so they get a longer budget for slow tool loops.
const NON_STREAM_BUDGET_MS = Number(process.env.AGENT_TIME_BUDGET_MS || 50_000);
const STREAM_BUDGET_MS = Number(process.env.AGENT_STREAM_BUDGET_MS || 110_000);
const KEEPALIVE_INTERVAL_MS = 15_000;

router.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: [{ id: MODEL, object: 'model', created: 0, owned_by: 'rwa-outlets' }],
  });
});

router.post('/v1/chat/completions', async (req, res) => {
  const { messages, stream } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: { message: 'messages must be a non-empty array', type: 'invalid_request_error' },
    });
  }

  const id = completionId();
  const created = Math.floor(Date.now() / 1000);
  const base = { id, object: 'chat.completion.chunk', created, model: MODEL };

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
    send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });

    // SSE comment lines keep nginx's proxy-read-timeout from firing while
    // the agent is inside a long tool loop with nothing to say yet.
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_INTERVAL_MS);

    try {
      const result = await runAgent(messages, (delta) => {
        send({ ...base, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] });
      }, STREAM_BUDGET_MS);
      const finish = result.stopReason === 'max_tokens' ? 'length' : 'stop';
      send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] });
    } catch (err) {
      console.error('[chat] stream error:', err);
      send({
        ...base,
        choices: [{
          index: 0,
          delta: { content: `\n\n[error] ${publicError(err)}` },
          finish_reason: 'stop',
        }],
      });
    } finally {
      clearInterval(keepalive);
    }
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  try {
    const result = await runAgent(messages, null, NON_STREAM_BUDGET_MS);
    return res.json({
      id,
      object: 'chat.completion',
      created,
      model: MODEL,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: result.text },
        finish_reason: result.stopReason === 'max_tokens' ? 'length' : 'stop',
      }],
      usage: {
        prompt_tokens: result.usage.input_tokens,
        completion_tokens: result.usage.output_tokens,
        total_tokens: result.usage.input_tokens + result.usage.output_tokens,
      },
    });
  } catch (err) {
    console.error('[chat] error:', err);
    const status = err.code === 'AGENT_NOT_CONFIGURED' ? 503
      : err.code === 'AGENT_TIMEOUT' ? 504
        : err.code === 'SUBGRAPH_TOOL_ERROR' || err.status === 401 ? 502
          : 500;
    return res.status(status).json({
      error: { message: publicError(err), type: 'server_error' },
    });
  }
});

function publicError(err) {
  if (err.code === 'AGENT_NOT_CONFIGURED') {
    return 'Chat is not configured on this deployment (set GROQ_API_KEY or ANTHROPIC_API_KEY, plus SUBGRAPH_URL).';
  }
  if (err.code === 'AGENT_TIMEOUT') {
    return 'The assistant ran out of time answering this — try a narrower question.';
  }
  if (err.code === 'SUBGRAPH_TOOL_ERROR') {
    // Surfaces persistent subgraph failures (e.g. missing GRAPH_API_KEY for
    // gateway endpoints) instead of spinning until the ingress 504s.
    return err.message;
  }
  if (err.status === 401 || /invalid api key/i.test(err.message || '')) {
    return 'The chat provider rejected the configured API key — check GROQ_API_KEY / ANTHROPIC_API_KEY.';
  }
  if (err.status === 404 && /model/i.test(err.message || '')) {
    return 'The configured model was not found on the provider — check GROQ_MODEL.';
  }
  if (err.status === 429) {
    return 'The chat provider is rate-limiting us — try again in a moment.';
  }
  return 'The assistant hit an internal error. Please try again.';
}

module.exports = router;
