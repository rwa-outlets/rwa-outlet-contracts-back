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
};

module.exports = env;
