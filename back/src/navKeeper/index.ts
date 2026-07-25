import { requireEnv } from "../env.js";
import { getPublicClient, getWalletClient } from "../chain/swapVM.js";

/**
 * Standalone keeper: pushes NAV values to NavOracle.setNav(asset, nav1e18).
 * Docs describe this as "pushed by a keeper (demo: the curator agent)" —
 * run this on a cron/interval (see terraform/ for scheduling once that's
 * set up) or call runNavKeeperTick() directly from the agent loop.
 *
 * TODO: replace ASSETS with real demo asset addresses (rwaTBILL, rwaCREDIT)
 * once deployed, and wire a real NAV source (issuer feed / accrual model —
 * see rwa-outlets-redemption_queue_simulation for the accrual math this
 * mirrors: 5.3% APY on rwaCREDIT from NAV 1.0432).
 */
interface AssetNavConfig {
  address: `0x${string}`;
  label: string;
  aprBps: number; // annualized, for accrual-based NAV between real feed updates
}

const ASSETS: AssetNavConfig[] = [
  // { address: "0x...", label: "rwaCREDIT", aprBps: 530 },
];

// TODO: replace with real NavOracle ABI once
// smartcontracts/out/NavOracle.sol/NavOracle.json exists.
const NAV_ORACLE_ABI = [] as const;

async function pushNav(asset: AssetNavConfig, nav1e18: bigint) {
  const navOracleAddress = requireEnv("NAV_ORACLE_ADDRESS");
  const wallet = getWalletClient();
  void getPublicClient();
  void navOracleAddress;
  void NAV_ORACLE_ABI;
  void wallet;
  throw new Error(
    `pushNav not wired yet for ${asset.label} — needs NavOracle ABI + address (nav=${nav1e18})`,
  );
}

export async function runNavKeeperTick() {
  for (const asset of ASSETS) {
    // Placeholder accrual calc — replace with real issuer NAV feed.
    const nav1e18 = 0n;
    await pushNav(asset, nav1e18);
  }
}

// Allow running directly: `pnpm nav-keeper`
if (import.meta.url === `file://${process.argv[1]}`) {
  runNavKeeperTick()
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(err);
      process.exit(1);
    });
}
