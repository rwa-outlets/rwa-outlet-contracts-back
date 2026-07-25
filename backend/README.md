# RWA Outlets — Backend

Plain Node + Express API for the frontend, backed by MongoDB. Matches the
contract in `terraform/README.md`: listens on `PORT` (3000), answers `200`
on `GET /health`, everything else lives under `/api/*`.

It currently replaces the frontend's `mockData.js` with real endpoints
backed by static reference config (assets/pools/vaults — same shape the
contracts define) plus MongoDB for the parts that actually change
(redemption queue requests, vault positions, trade history, notifications).
Wallet/tx execution is still simulated, same as the frontend's own
"Known Limitations" — wiring these to `RedemptionQueue.sol` / `CuratorVault.sol`
via viem, and to the subgraph for live reads, is the next step.

## Run locally

```bash
cp .env.example .env   # point MONGO_URI at a local/dev Mongo
npm install
npm run dev
```

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | liveness/readiness probe |
| GET | `/api/assets`, `/api/assets/:id` | RWA + stablecoin definitions |
| GET | `/api/pool-types` | Express / Patient / Market descriptions |
| GET | `/api/pools?type=` | pool listing, optional type filter |
| GET | `/api/pools/:id` | single pool |
| GET | `/api/trades?poolId=&limit=` | trade history |
| POST | `/api/trades` | simulate a swap `{ poolId, direction, amount, maker }` |
| GET | `/api/queue?user=&status=` | redemption queue requests |
| POST | `/api/queue` | create a request `{ user, assetId, amountTokens }` |
| POST | `/api/queue/:id/claim` | claim a `Claimable` request |
| POST | `/api/queue/:id/mark-claimable` | demo helper to advance a request |
| GET | `/api/vaults`, `/api/vaults/:id` | curator vault config |
| GET | `/api/vault-positions?user=&vaultId=` | LP positions |
| POST | `/api/vault-positions` | deposit `{ user, vaultId, amount }` |
| POST | `/api/vault-positions/:id/withdraw` | request withdrawal `{ amountShares }` |
| GET | `/api/dashboard` | TVL/volume/queue summary |
| GET | `/api/yield-breakdown` | yield source split |
| GET | `/api/curator-agents` | curator agent status |
| GET | `/api/notifications?user=` | per-user notifications |
| POST | `/api/notifications/:id/read` | mark read |
| POST | `/api/v1/chat/completions` | OpenAI-compatible chat — Claude agent over the subgraph (supports `stream: true`) |
| GET | `/api/v1/models` | OpenAI-compatible model listing |

## Chat agent

`POST /api/v1/chat/completions` is an OpenAI-compatible facade: point any OpenAI
client at baseURL `<backend>/api/v1` (any `model` value is accepted; the server
picks its own). Behind it, an LLM runs a tool-use loop against the subgraph MCP
server (`src/mcp/subgraph-server.js`), which exposes `get_subgraph_schema` and
`query_subgraph` — so answers about pools, trades, NAV, queues, and vaults come
from indexed chain state, not mock data. The MCP server runs in-process
(in-memory transport — no extra port or process).

Providers: Groq (`GROQ_API_KEY` + `GROQ_MODEL`, OpenAI-compatible) is preferred
when set; Anthropic (`ANTHROPIC_API_KEY`, defaults to `claude-opus-5` with
server-side refusal fallbacks) otherwise. `SUBGRAPH_URL` is required either way
— it defaults to The Graph gateway endpoint, which also needs `GRAPH_API_KEY`
(sent as `Authorization: Bearer`); with no provider key the route answers 503
and the rest of the API works as before. The MCP server also runs standalone
for Claude Desktop / other MCP hosts: `SUBGRAPH_URL=... GRAPH_API_KEY=... npm
run mcp` (stdio transport).

## Deploy

Built and pushed per `terraform/README.md` — `docker build -t
registry.digitalocean.com/rwa-outlets/backend:main ./backend`. Terraform
supplies `PORT`, `MONGO_URI`, `JWT_SECRET`, `FRONTEND_URL`, `BASE_URL`,
`SUBGRAPH_URL`, `GRAPH_API_KEY` (secret), `GROQ_MODEL`, and `GROQ_API_KEY`
(secret) as pod env vars;
`src/env.js` fails fast if any required var is missing.
