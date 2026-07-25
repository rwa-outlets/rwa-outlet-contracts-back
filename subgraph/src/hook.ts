import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";

import { ObservationRecorded, ObservationRecorded1 } from "../generated/RWAGateHook/RWAGateHook";
import { Asset, Observation, V4Pool } from "../generated/schema";
import { ensureV4Pool, eventId, ZERO } from "./helpers";
import { USDC } from "./addresses";

/// Current hook: the event carries the decimals-normalized USDC-per-RWA rate.
export function handleObservation(event: ObservationRecorded): void {
  record(
    event.params.poolId,
    event.params.sqrtPriceX96,
    event.params.rate1e18,
    event.params.cumulativeX128,
    event
  );
}

/// Hooks deployed before rate1e18 existed: derive the rate from sqrtPriceX96 once the
/// router's TWAP guard has linked the poolId to an asset (GuardSet).
export function handleObservationLegacy(event: ObservationRecorded1): void {
  const pool = ensureV4Pool(event.params.poolId, event.block.timestamp);
  let rate = ZERO;
  const assetId = pool.asset;
  if (assetId !== null) {
    const asset = Asset.load(assetId);
    if (asset != null) rate = rateFromSqrtPrice(event.params.sqrtPriceX96, asset);
  }
  record(event.params.poolId, event.params.sqrtPriceX96, rate, event.params.cumulativeX128, event);
}

function record(
  poolId: Bytes,
  sqrtPriceX96: BigInt,
  rate1e18: BigInt,
  cumulativeX128: BigInt,
  event: ethereum.Event
): void {
  const pool = ensureV4Pool(poolId, event.block.timestamp);
  pool.lastSqrtPriceX96 = sqrtPriceX96;
  pool.lastRate1e18 = rate1e18;
  pool.observationCount += 1;
  pool.lastObservationAt = event.block.timestamp;
  pool.save();

  const observation = new Observation(eventId(event));
  observation.pool = pool.id;
  observation.sqrtPriceX96 = sqrtPriceX96;
  observation.rate1e18 = rate1e18;
  observation.cumulativeX128 = cumulativeX128;
  observation.timestamp = event.block.timestamp;
  observation.block = event.block.number;
  observation.save();
}

/// Mirrors RWAGateHook._toUsdcPerRwa1e18: priceX128 = (sqrtP/2^96)^2 × 2^128, then
/// decimals-normalize according to v4 currency ordering (lower address = currency0).
function rateFromSqrtPrice(sqrtPriceX96: BigInt, rwa: Asset): BigInt {
  if (sqrtPriceX96.equals(ZERO)) return ZERO;

  let usdcDecimals = 6;
  const usdcAsset = Asset.load(Address.fromString(USDC));
  if (usdcAsset != null) usdcDecimals = usdcAsset.decimals;

  const priceX128 = sqrtPriceX96.times(sqrtPriceX96).rightShift(64);
  const exponent = 18 + rwa.decimals - usdcDecimals;
  const scale = BigInt.fromI32(10).pow(u8(exponent));
  const q128 = BigInt.fromI32(1).leftShift(128);

  const rwaIsCurrency0 = rwa.id.toHexString() < USDC;
  if (rwaIsCurrency0) {
    // price = USDC-per-RWA raw
    return priceX128.times(scale).div(q128);
  }
  // price = RWA-per-USDC raw — invert
  if (priceX128.equals(ZERO)) return ZERO;
  return scale.times(q128).div(priceX128);
}
