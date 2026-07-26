// Single source of truth for environment config.
// Never reach for `process.env.X` anywhere else — import this instead.
require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  MONGO_URI: required('MONGO_URI', 'mongodb://127.0.0.1:27017/appdb'),
  JWT_SECRET: required('JWT_SECRET', 'dev-only-secret-change-me'),
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  BASE_URL: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  // Chat agent (optional — /api/v1/chat/completions returns 503 when no
  // provider key is set). Priority: OpenAI, then Groq, then Anthropic.
  // The Graph gateway endpoint; the gateway rejects unauthenticated requests,
  // so GRAPH_API_KEY must be set alongside it (sent as Authorization: Bearer).
  SUBGRAPH_URL:
    process.env.SUBGRAPH_URL ||
    'https://gateway.thegraph.com/api/deployments/id/Qmb6FUopoDYFrHBZvAazMBH9qsrNVcSgtz8jmUAGKzSqMu',
  GRAPH_API_KEY: process.env.GRAPH_API_KEY || null,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || null,
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  GROQ_MODEL: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  // Hedera agentic payments (optional — the whole feature is off until both
  // HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY are set). Testnet keys only.
  HEDERA_ACCOUNT_ID: process.env.HEDERA_ACCOUNT_ID || null,
  HEDERA_PRIVATE_KEY: process.env.HEDERA_PRIVATE_KEY || null,
  HEDERA_NETWORK: process.env.HEDERA_NETWORK || 'testnet',
  // HCS audit topic (created by scripts/hedera-setup.js; pin to keep one trail).
  HEDERA_HCS_TOPIC_ID: process.env.HEDERA_HCS_TOPIC_ID || null,
  // Where per-query data fees go (second testnet account; fees are skipped when unset).
  HEDERA_FEE_COLLECTOR_ID: process.env.HEDERA_FEE_COLLECTOR_ID || null,
  HEDERA_QUERY_FEE_HBAR: Number(process.env.HEDERA_QUERY_FEE_HBAR || '0.001'),
  // Hard cap for the agent-facing hedera_transfer_hbar tool.
  HEDERA_MAX_TRANSFER_HBAR: Number(process.env.HEDERA_MAX_TRANSFER_HBAR || '10'),
};

module.exports = env;
