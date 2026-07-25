import { GraphQLClient, gql } from "graphql-request";
import { env, requireEnv } from "../env.js";

/**
 * The one and only path agent decisions read chain state through.
 * Per sponsor-thegraph.mdc: "agent decisions come from subgraph queries —
 * not RPC reads that bypass it." Keep every query in this file so it's
 * trivial for judges (and future-you) to audit where data comes from.
 */
let client: GraphQLClient | undefined;

function getClient(): GraphQLClient {
  if (!client) {
    client = new GraphQLClient(requireEnv("SUBGRAPH_URL"));
  }
  return client;
}

// --- Types -----------------------------------------------------------------
// These mirror the entities schema.graphql will define once subgraph/ exists
// (see rwa-outlet-contracts-core/docs/03-contracts.md for event sources).
// Update this file the moment schema.graphql lands — see
// .cursor/rules/graph-contracts-sync.mdc.

export interface PoolSnapshot {
  strategyHash: string;
  asset: string;
  poolType: "Express" | "Patient" | "Market";
  navBps: number;
  inventory: string; // wei string
  lastTradeAt: string | null;
}

export interface RedemptionEpochSnapshot {
  epoch: string;
  asset: string;
  status: "Pending" | "SubmittedToIssuer" | "Claimable";
  pendingShares: string;
  claimableShares: string;
}

export interface CuratorVaultSnapshot {
  vaultAddress: string;
  riskTier: string;
  totalAssets: string;
  idleUsdc: string;
  mandateAssets: string[];
}

// --- Queries -----------------------------------------------------------------

const POOLS_QUERY = gql`
  query Pools {
    pools {
      strategyHash
      asset
      poolType
      navBps
      inventory
      lastTradeAt
    }
  }
`;

const REDEMPTION_EPOCHS_QUERY = gql`
  query RedemptionEpochs($status: String) {
    redemptionEpochs(where: { status: $status }) {
      epoch
      asset
      status
      pendingShares
      claimableShares
    }
  }
`;

const CURATOR_VAULTS_QUERY = gql`
  query CuratorVaults {
    curatorVaults {
      vaultAddress
      riskTier
      totalAssets
      idleUsdc
      mandateAssets
    }
  }
`;

export async function fetchPools(): Promise<PoolSnapshot[]> {
  const data = await getClient().request<{ pools: PoolSnapshot[] }>(POOLS_QUERY);
  return data.pools;
}

export async function fetchRedemptionEpochs(
  status?: RedemptionEpochSnapshot["status"],
): Promise<RedemptionEpochSnapshot[]> {
  const data = await getClient().request<{ redemptionEpochs: RedemptionEpochSnapshot[] }>(
    REDEMPTION_EPOCHS_QUERY,
    { status },
  );
  return data.redemptionEpochs;
}

export async function fetchCuratorVaults(): Promise<CuratorVaultSnapshot[]> {
  const data = await getClient().request<{ curatorVaults: CuratorVaultSnapshot[] }>(
    CURATOR_VAULTS_QUERY,
  );
  return data.curatorVaults;
}

export function isSubgraphConfigured(): boolean {
  return Boolean(env.SUBGRAPH_URL);
}
