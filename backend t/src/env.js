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
  // provider key is set). Groq is preferred when both keys are present.
  GROQ_API_KEY: process.env.GROQ_API_KEY || null,
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  SUBGRAPH_URL: process.env.SUBGRAPH_URL || null,
};

module.exports = env;
