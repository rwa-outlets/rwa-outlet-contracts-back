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
| GET | `/api/hedera/status` | agent treasury on Hedera testnet: operator, balance, HCS topic |
| GET | `/api/hedera/receipts` | last 50 autonomous settlements (payments + HCS logs) with hashscan links |

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

## Hedera — agentic payments (hackathon judges: start here)

The curator agent settles its economics on **Hedera testnet**, integrated
directly with `@hashgraph/sdk` (qualifying path: *"Hedera SDKs directly"*).
Two payment flows, both autonomous:

1. **Per-query data fees.** Every chat/curator run that reads the subgraph is
   metered: after the answer is produced, the backend **pays
   `HEDERA_QUERY_FEE_HBAR × queries`** from the agent treasury to the
   fee-collector account (memo `rwa-outlets:data-fee:<n>q`) and **appends the
   decision record** — question, tools used, fee tx id, answer preview — to a
   public **HCS audit topic**. Fire-and-forget: Hedera is the payment rail,
   never a dependency of answering. This is the x402-style pay-per-use pattern
   with the agent as the paying party.
2. **Agent-initiated transfers.** The LLM holds a `hedera_transfer_hbar` tool
   (plus `hedera_get_treasury`, `hedera_log_decision`) — ask the agent to
   settle a fee and it executes the transfer itself and cites the hashscan
   link. Amounts are capped server-side by `HEDERA_MAX_TRANSFER_HBAR`.

Architecture (mirrors the subgraph MCP design — in-process, no extra port):

```text
chat request ─▶ LLM tool loop (src/services/agent.js)
                  ├─ subgraph MCP  (src/mcp/subgraph-server.js) ── The Graph
                  └─ hedera MCP    (src/mcp/hedera-server.js)  ─┐
                after answer: settleAgentRun()                  ├─ @hashgraph/sdk
                  (src/services/hedera.js) ─────────────────────┘   Hedera testnet
                  ├─ TransferTransaction  → per-query fee (hashscan link)
                  └─ TopicMessageSubmit   → HCS decision record (hashscan link)
```

Every settlement is exposed at **`GET /api/hedera/receipts`** (last 50, each
with its `hashscan.io/testnet` link) and **`GET /api/hedera/status`** (operator
account, live balance, topic id). That receipts feed is the demo evidence.

Setup (testnet keys only — never funded mainnet keys):

```bash
# 1. create + fund an account at https://portal.hedera.com (faucet)
# 2. in .env: HEDERA_ACCOUNT_ID=0.0.xxxx  HEDERA_PRIVATE_KEY=<der/ecdsa hex>
npm run hedera:setup   # creates HCS topic + fee-collector, sends proof txs,
                       # prints hashscan links and the env ids to pin
# 3. pin the printed HEDERA_HCS_TOPIC_ID / HEDERA_FEE_COLLECTOR_ID in .env
npm run dev
```

Files: [`src/services/hedera.js`](src/services/hedera.js) (SDK integration:
transfers, HCS, settlement hook), [`src/mcp/hedera-server.js`](src/mcp/hedera-server.js)
(the agent's treasury tools; also standalone via `npm run mcp:hedera`),
[`src/routes/hedera.js`](src/routes/hedera.js) (receipts/status),
[`scripts/hedera-setup.js`](scripts/hedera-setup.js) (one-shot bootstrap).

## Deploy

Built and pushed per `terraform/README.md` — `docker build -t
registry.digitalocean.com/rwa-outlets/backend:main ./backend`. Terraform
supplies `PORT`, `MONGO_URI`, `JWT_SECRET`, `FRONTEND_URL`, `BASE_URL`,
`SUBGRAPH_URL`, `GRAPH_API_KEY` (secret), `GROQ_MODEL`, `GROQ_API_KEY`
(secret), and the `HEDERA_*` treasury vars (`HEDERA_PRIVATE_KEY` as a secret)
as pod env vars; `src/env.js` fails fast if any required var is missing.
