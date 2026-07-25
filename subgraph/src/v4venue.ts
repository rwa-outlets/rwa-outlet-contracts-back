import { PoolRegistered, V4Swapped } from "../generated/V4Venue/V4Venue";
import { V4Pool, V4Swap } from "../generated/schema";
import { ensureAccount, ensureAsset, ensureV4Pool, eventId } from "./helpers";

/// Links asset ↔ v4 pool and records the pool config. Fires before any venue swap
/// (the router only routes to v4 once the pool is registered).
export function handlePoolRegistered(event: PoolRegistered): void {
  const asset = ensureAsset(event.params.asset);
  const pool = ensureV4Pool(event.params.poolId, event.block.timestamp);

  pool.asset = asset.id;
  pool.fee = event.params.fee.toI32();
  pool.tickSpacing = event.params.tickSpacing;
  pool.hooks = event.params.hooks;
  pool.registeredAt = event.block.timestamp;
  pool.save();

  asset.v4Pool = pool.id;
  asset.save();
}

/// Every swap through the venue — router-routed (paired with a same-tx InstantExit/
/// Purchase) or called directly. USDC-side volume accumulates on the pool.
export function handleV4Swapped(event: V4Swapped): void {
  const asset = ensureAsset(event.params.asset);
  const account = ensureAccount(event.params.user, event.block.timestamp);

  const swap = new V4Swap(eventId(event));
  swap.asset = asset.id;
  swap.user = account.id;
  swap.recipient = event.params.recipient;
  swap.assetForUsdc = event.params.assetForUsdc;
  swap.amountIn = event.params.amountIn;
  swap.amountOut = event.params.amountOut;
  swap.timestamp = event.block.timestamp;
  swap.txHash = event.transaction.hash;

  const poolId = asset.v4Pool;
  if (poolId !== null) {
    const pool = V4Pool.load(poolId);
    if (pool != null) {
      swap.pool = pool.id;
      pool.swapCount += 1;
      const usdcSide = event.params.assetForUsdc ? event.params.amountOut : event.params.amountIn;
      pool.volumeUsdc = pool.volumeUsdc.plus(usdcSide);
      pool.save();
    }
  }
  swap.save();
}
