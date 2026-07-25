import Fastify from "fastify";

/**
 * A fake subgraph you can point SUBGRAPH_URL at for manual, real-HTTP
 * end-to-end testing before subgraph/ actually exists. Not part of the
 * production build — dev tool only.
 *
 * Run:  pnpm mock-subgraph
 * Then: SUBGRAPH_URL=http://localhost:8090/graphql pnpm dev   (in another shell)
 *       curl -X POST http://localhost:8080/api/agent/run -H 'content-type: application/json' -d '{}'
 *       curl http://localhost:8080/api/agent/decisions
 */
const app = Fastify({ logger: true });

const POOLS = [
  {
    strategyHash: "0xpool1",
    asset: "0xRWATBILL",
    poolType: "Express",
    navBps: 10000,
    inventory: "5000000000000000000000",
    lastTradeAt: null,
  },
];

const REDEMPTION_EPOCHS = [
  {
    epoch: "12",
    asset: "0xRWACREDIT",
    status: "Claimable",
    pendingShares: "0",
    claimableShares: "1000000000000000000",
  },
  {
    epoch: "13",
    asset: "0xRWACREDIT",
    status: "Pending",
    pendingShares: "500000000000000000",
    claimableShares: "0",
  },
];

const CURATOR_VAULTS = [
  {
    vaultAddress: "0xVAULT1",
    riskTier: "Express",
    totalAssets: "5000000000",
    idleUsdc: "2000000000",
    mandateAssets: ["0xRWATBILL"],
  },
];

app.post("/graphql", async (req) => {
  const body = req.body as { query: string; variables?: Record<string, unknown> };
  const q = body.query;

  if (q.includes("pools")) {
    return { data: { pools: POOLS } };
  }
  if (q.includes("redemptionEpochs")) {
    const status = body.variables?.status as string | undefined;
    const filtered = status ? REDEMPTION_EPOCHS.filter((e) => e.status === status) : REDEMPTION_EPOCHS;
    return { data: { redemptionEpochs: filtered } };
  }
  if (q.includes("curatorVaults")) {
    return { data: { curatorVaults: CURATOR_VAULTS } };
  }
  return { errors: [{ message: "unknown query in mock subgraph" }] };
});

app
  .listen({ port: 8090, host: "0.0.0.0" })
  .then((addr) => app.log.info(`mock subgraph listening on ${addr}/graphql`));
