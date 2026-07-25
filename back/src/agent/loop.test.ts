import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the subgraph client BEFORE importing loop.ts, so runAgentCycle never
// makes a real network call. This is the fast, no-network way to prove the
// reasoning logic is correct.
vi.mock("../subgraph/client.js", () => ({
  isSubgraphConfigured: () => true,
  fetchPools: vi.fn().mockResolvedValue([]),
  fetchRedemptionEpochs: vi.fn().mockResolvedValue([
    {
      epoch: "12",
      asset: "0xRWACREDIT",
      status: "Claimable",
      pendingShares: "0",
      claimableShares: "1000000000000000000",
    },
  ]),
  fetchCuratorVaults: vi.fn().mockResolvedValue([
    {
      vaultAddress: "0xVAULT1",
      riskTier: "Express",
      totalAssets: "5000000000",
      idleUsdc: "2000000000",
      mandateAssets: ["0xRWATBILL"],
    },
  ]),
}));

import { runAgentCycle } from "./loop.js";
import { getDecisionLog } from "./decisionLog.js";

describe("runAgentCycle", () => {
  beforeEach(() => {
    // decisionLog is a module-level array with no reset export; each test
    // just asserts on the tail it appended, since order is preserved.
  });

  it("logs a fulfillRedeemEpoch decision for each Claimable epoch", async () => {
    const result = await runAgentCycle({ dryRun: false });
    expect(result.decisionsCount).toBeGreaterThanOrEqual(2);

    const log = getDecisionLog();
    const epochDecision = log.find(
      (d) => d.action.type === "fulfillRedeemEpoch" && d.action.epoch === "12",
    );
    expect(epochDecision).toBeDefined();
    expect(epochDecision?.entities).toMatchObject({ epoch: "12", status: "Claimable" });
  });

  it("logs a createPool decision for a vault with idle USDC against its mandate", async () => {
    const result = await runAgentCycle({ dryRun: false });
    expect(result.decisionsCount).toBeGreaterThanOrEqual(1);

    const log = getDecisionLog();
    const poolDecision = log.find(
      (d) => d.action.type === "createPool" && d.action.asset === "0xRWATBILL",
    );
    expect(poolDecision).toBeDefined();
  });

  it("respects dryRun by recording action type 'none' instead of acting", async () => {
    await runAgentCycle({ dryRun: true });
    const log = getDecisionLog();
    // most recent entries should be 'none' actions since dryRun=true
    const recent = log.slice(0, 2);
    expect(recent.every((d) => d.action.type === "none")).toBe(true);
  });
});
