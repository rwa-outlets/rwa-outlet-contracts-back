import "dotenv/config";
import { z } from "zod";

/**
 * Single source of truth for process.env. Never reach for `process.env.X`
 * anywhere else in the codebase — import `env` from here instead.
 * Fails fast (throws on import) if anything required is missing/malformed.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  // The Graph / Subgraph Studio — required once the subgraph is deployed.
  // Optional for now so the service can boot before the subgraph exists;
  // the subgraph client throws a clear error at call time if this is unset.
  SUBGRAPH_URL: z.string().url().optional(),

  // Chain RPCs
  TESTNET_RPC_URL: z.string().url().optional(),
  MAINNET_RPC_URL: z.string().url().optional(),

  // Agent signer — testnet-only, never a funded mainnet key. Never logged
  // or returned by any endpoint.
  AGENT_PRIVATE_KEY: z.string().optional(),

  // Hedera testnet (required for Hedera prize track)
  HEDERA_ACCOUNT_ID: z.string().optional(),
  HEDERA_PRIVATE_KEY: z.string().optional(),

  // Deployed contract addresses (filled in once contracts land on testnet)
  NAV_ORACLE_ADDRESS: z.string().optional(),
  OUTLET_ROUTER_ADDRESS: z.string().optional(),
  CURATOR_VAULT_ADDRESS: z.string().optional(),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed — see errors above");
}

export const env = parsed.data;

/** Throws with a clear message if a var needed for a specific feature is missing. */
export function requireEnv<K extends keyof typeof env>(key: K): NonNullable<(typeof env)[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${String(key)} (needed for this feature — check .env)`);
  }
  return value as NonNullable<(typeof env)[K]>;
}
