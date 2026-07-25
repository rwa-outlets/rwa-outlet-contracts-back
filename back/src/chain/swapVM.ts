import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { requireEnv } from "../env.js";

/**
 * Taker flow against the official AquaSwapVMRouter: quote() via asView()
 * first, then swap() with the SAME takerData/threshold/deadline. Never
 * change takerData between quote and swap — the official contract enforces
 * quote==swap consistency and this is exactly the mismatch that breaks it.
 *
 * Fill in `AQUA_SWAP_VM_ROUTER_ABI` from smartcontracts/out/ once the repo
 * is wired up (per graph-contracts-sync.mdc — regenerate, never hand-edit).
 */

let publicClient: ReturnType<typeof createPublicClient> | undefined;
let walletClient: ReturnType<typeof createWalletClient> | undefined;

export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      transport: http(requireEnv("TESTNET_RPC_URL")),
    });
  }
  return publicClient;
}

export function getWalletClient() {
  if (!walletClient) {
    const account = privateKeyToAccount(requireEnv("AGENT_PRIVATE_KEY") as `0x${string}`);
    walletClient = createWalletClient({
      account,
      transport: http(requireEnv("TESTNET_RPC_URL")),
    });
  }
  return walletClient;
}

export interface QuoteParams {
  routerAddress: Address;
  strategyHash: `0x${string}`;
  takerData: `0x${string}`;
}

export interface QuoteResult {
  amountOut: bigint;
  // raw calldata/threshold needed to submit the matching swap() — keep
  // these byte-identical to what asView().quote() returned.
}

// TODO: replace with real AquaSwapVMRouter ABI calls once
// smartcontracts/out/AquaSwapVMRouter.sol/AquaSwapVMRouter.json exists.
export async function quote(_params: QuoteParams): Promise<QuoteResult> {
  throw new Error(
    "quote() not wired yet — needs AquaSwapVMRouter ABI + deployed address from smartcontracts/",
  );
}

export async function swap(_params: QuoteParams & { minOut: bigint; deadline: bigint }) {
  throw new Error(
    "swap() not wired yet — needs AquaSwapVMRouter ABI + deployed address from smartcontracts/",
  );
}
