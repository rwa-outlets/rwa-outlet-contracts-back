import {
  fetchCuratorVaults,
  fetchPools,
  fetchRedemptionEpochs,
  isSubgraphConfigured,
} from "../subgraph/client.js";
import { recordDecision } from "./decisionLog.js";

export interface AgentCycleResult {
  ranAt: string;
  decisionsCount: number;
  skipped?: string;
}

/**
 * One query -> reason -> act cycle, per back.mdc. Trigger this on a timer
 * in production; exposed as POST /api/agent/run for the demo.
 *
 * Deliberately dumb reasoning for now (threshold checks) so the plumbing
 * (subgraph -> decision -> logged action -> onchain call) is provably
 * correct end to end before any LLM call goes in. Swap the reasoning
 * section for a real model call once that plumbing is proven.
 */
export async function runAgentCycle(opts: { dryRun: boolean }): Promise<AgentCycleResult> {
  if (!isSubgraphConfigured()) {
    return {
      ranAt: new Date().toISOString(),
      decisionsCount: 0,
      skipped: "SUBGRAPH_URL not set — deploy the subgraph and set the env var to run real cycles",
    };
  }

  const [pools, claimableEpochs, vaults] = await Promise.all([
    fetchPools(),
    fetchRedemptionEpochs("Claimable"),
    fetchCuratorVaults(),
  ]);

  let decisionsCount = 0;

  // Example decision: any Claimable redemption epoch should be fulfilled so
  // LP exits can proceed (CuratorVault.fulfillRedeemEpoch).
  for (const epoch of claimableEpochs) {
    recordDecision({
      query: `redemptionEpochs(where: { status: Claimable }) — epoch ${epoch.epoch}`,
      entities: epoch,
      reasoning: `Epoch ${epoch.epoch} for asset ${epoch.asset} is Claimable with ${epoch.claimableShares} shares owed. Freeing settlement cash unblocks LP exits.`,
      action: opts.dryRun
        ? { type: "none" }
        : { type: "fulfillRedeemEpoch", epoch: epoch.epoch },
    });
    decisionsCount++;
  }

  // Example decision: vaults sitting on idle USDC with headroom against
  // their mandate should have a pool created/rebalanced.
  for (const vault of vaults) {
    if (BigInt(vault.idleUsdc || "0") > 0n && vault.mandateAssets.length > 0) {
      const asset = vault.mandateAssets[0]!;
      recordDecision({
        query: `curatorVaults — vault ${vault.vaultAddress}`,
        entities: vault,
        reasoning: `Vault ${vault.vaultAddress} (tier ${vault.riskTier}) holds ${vault.idleUsdc} idle USDC against mandate asset ${asset}. Shipping into a pool puts capital to work.`,
        action: opts.dryRun
          ? { type: "none" }
          : { type: "createPool", asset, poolType: "Express" },
      });
      decisionsCount++;
    }
  }

  void pools; // reserved for spread-widening / rebalance logic

  return { ranAt: new Date().toISOString(), decisionsCount };
}
