# back — API + AI curator agent

Node 22, TypeScript strict, Fastify, pnpm. Runs on DO App Platform on `PORT` (8080), reached
through the `/api` path prefix. `GET /health` stays outside `/api` — the App Platform health
check depends on it returning 200.

## Status

Scaffolded, not yet wired to live contracts/subgraph. Everything is structured so each piece
below can be filled in independently as the rest of the team ships:

| Piece | File | Needs |
|---|---|---|
| Subgraph client | `src/subgraph/client.ts` | `subgraph/` deployed to Studio, `SUBGRAPH_URL` set, `schema.graphql` entities matched here |
| Agent loop | `src/agent/loop.ts` | subgraph client working; currently threshold-based reasoning, no LLM yet |
| Decision log | `src/agent/decisionLog.ts` | nothing — works now, `GET /api/agent/decisions` |
| SwapVM client | `src/chain/swapVM.ts` | `smartcontracts/out/AquaSwapVMRouter.sol/*.json` ABI + deployed router address |
| Hedera client | `src/chain/hedera.ts` | `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` (testnet, fund via portal.hedera.com faucet) |
| NAV keeper | `src/navKeeper/index.ts` | `smartcontracts/out/NavOracle.sol/*.json` ABI + `NAV_ORACLE_ADDRESS` |

## Setup

```bash
corepack enable
cp .env.example .env   # fill in as pieces above come online
pnpm install
pnpm dev                # tsx watch, http://localhost:8080
```

## Routes

- `GET /health` — liveness, required by DO App Platform.
- `GET /api/agent/decisions` — the full reasoning log (query + entities + action) per decision.
- `POST /api/agent/run` — trigger one query → reason → act cycle. Body: `{ "dryRun": boolean }`.

## Testing

Two levels, since there's no real subgraph/contracts yet:

**1. Unit tests (fast, no network)** — mocks `src/subgraph/client.ts` entirely and asserts on
the reasoning logic + decision log:

```bash
pnpm test
```

See `src/agent/loop.test.ts` for the pattern — mock the subgraph functions, call
`runAgentCycle()`, assert on `getDecisionLog()`.

**2. Manual end-to-end smoke test (real HTTP, fake data)** — runs a tiny fake subgraph server so
you exercise the real Fastify routes over real HTTP:

```bash
# terminal 1
pnpm mock-subgraph          # fake subgraph on :8090/graphql

# terminal 2
SUBGRAPH_URL=http://localhost:8090/graphql pnpm dev   # or set it in .env

# terminal 3 — smoke test the routes
curl http://localhost:8080/health
curl http://localhost:8080/api/agent/decisions
curl -X POST http://localhost:8080/api/agent/run \
  -H 'content-type: application/json' \
  -d '{"dryRun": false}'
curl http://localhost:8080/api/agent/decisions   # should now show entries
```

With `SUBGRAPH_URL` unset, `POST /api/agent/run` returns `{ skipped: "SUBGRAPH_URL not set..." }`
instead of erroring — useful to confirm the plumbing degrades gracefully before anything real
exists.

Once the real subgraph is deployed, point `SUBGRAPH_URL` at it instead of the mock and re-run the
same curl commands — no code changes needed, since routes/loop don't know the difference.

## Architecture notes

- One typed env module (`src/env.ts`) — never `process.env.X` inline elsewhere.
- All subgraph reads go through `src/subgraph/client.ts` — this is load-bearing for the Graph
  prize track (judges must be able to see every agent decision traces back to a subgraph query,
  not an RPC read that bypasses it).
- Every agent decision is logged via `recordDecision()` with its query + entities + action, even
  in dry-run mode (`action: { type: "none" }`) — this log is the demo evidence for both the Graph
  and Hedera (HCS audit-trail bonus) tracks.
- Execution paths:
  - DEX/outlet swaps: `quote()` via `asView()` first, then `swap()` with the **same** takerData,
    threshold, and deadline. Never let these drift — the official router enforces quote==swap
    consistency.
  - Payments: Hedera Agent Kit v4 on testnet. v4 loads zero tools by default — plugins must be
    passed explicitly.
- Restart-safe: DO redeploys on every push. Once wired to real state, persist last-processed
  block/cursor and dedupe against the decision log so a redeploy never re-executes an
  already-settled action.
- Secrets: `AGENT_PRIVATE_KEY` / `HEDERA_PRIVATE_KEY` are testnet-only and must never be logged
  or returned by any endpoint.

## Next steps, in order

1. Someone deploys `NavOracle`, `ComplianceNFT`, `NavExtruction` (M1) from
   `rwa-outlet-contracts-core` to Base Sepolia and records the address in the root README's
   deployed-addresses table.
2. `subgraph/` gets scaffolded against those addresses and deployed to Studio → `SUBGRAPH_URL`.
3. Update `src/subgraph/client.ts` queries/types to match the real `schema.graphql`.
4. Wire `src/chain/swapVM.ts` and `src/navKeeper/index.ts` with real ABIs from
   `smartcontracts/out/` (never hand-copy — regenerate per `graph-contracts-sync.mdc`).
5. Fund a Hedera testnet operator account, wire `src/chain/hedera.ts` to the Agent Kit toolkit,
   trigger a real payment from `runAgentCycle()`.
6. Replace the threshold reasoning in `src/agent/loop.ts` with an actual model call once 1–5 are
   proven end to end.
