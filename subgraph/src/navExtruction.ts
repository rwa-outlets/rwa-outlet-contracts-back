import { BigInt } from "@graphprotocol/graph-ts";

import { Trade as TradeEvent } from "../generated/NavExtruction/NavExtruction";
import { Trade, _TxOrderTrade } from "../generated/schema";
import { assetDay, BPS, ensureAsset, ensureStrategy, eventId, protocol, protocolDay, ZERO } from "./helpers";

/// NavExtruction.Trade — the pricing-context event emitted inside the official router's
/// swap. One per pool fill; the settlement-level Swapped of the same tx links back via
/// _TxOrderTrade.
export function handleTrade(event: TradeEvent): void {
  const asset = ensureAsset(event.params.asset);
  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.params.maker,
    event.address, // placeholder; Shipped/Swapped carry the real app
    event.block.timestamp
  );

  const trade = new Trade(eventId(event));
  trade.strategy = strategy.id;
  trade.poolId = event.params.poolId;
  trade.asset = asset.id;
  trade.isExit = event.params.isExit;
  trade.maker = event.params.maker;
  trade.taker = event.params.taker;
  trade.amountIn = event.params.amountIn;
  trade.amountOut = event.params.amountOut;
  trade.rateVsNavBps = event.params.rateVsNavBps;

  const nav = asset.nav;
  if (nav !== null) {
    trade.navAtTrade = nav;
    // execution rate = nav × (10000 + rateVsNavBps) / 10000
    trade.rate1e18 = nav.times(BPS.plus(event.params.rateVsNavBps)).div(BPS);
  } else {
    trade.navAtTrade = ZERO;
    trade.rate1e18 = ZERO;
  }

  trade.timestamp = event.block.timestamp;
  trade.block = event.block.number;
  trade.txHash = event.transaction.hash;
  trade.save();

  const link = new _TxOrderTrade(event.transaction.hash.concat(event.params.strategyHash));
  link.trade = trade.id;
  link.save();

  // USDC leg of the fill (exit pays USDC out, buy takes USDC in)
  const usdcVolume = event.params.isExit ? event.params.amountOut : event.params.amountIn;
  const rwaVolume = event.params.isExit ? event.params.amountIn : event.params.amountOut;

  if (strategy.kind == "UNKNOWN") {
    if (event.params.poolId == 1) strategy.kind = "EXPRESS";
    else if (event.params.poolId == 2) strategy.kind = "PATIENT";
    else if (event.params.poolId == 3) strategy.kind = "MARKET";
  }
  strategy.poolId = event.params.poolId;
  if (strategy.asset === null) strategy.asset = asset.id;
  strategy.tradeCount += 1;
  strategy.lastTradeAt = event.block.timestamp;
  strategy.lastTradeRateVsNavBps = event.params.rateVsNavBps;
  if (event.params.isExit) {
    strategy.exitVolumeUsdc = strategy.exitVolumeUsdc.plus(usdcVolume);
  } else {
    strategy.buyVolumeUsdc = strategy.buyVolumeUsdc.plus(usdcVolume);
  }
  strategy.save();

  asset.tradeCount += 1;
  asset.lastTradeAt = event.block.timestamp;
  if (event.params.isExit) {
    asset.exitVolume = asset.exitVolume.plus(rwaVolume);
    asset.exitVolumeUsdc = asset.exitVolumeUsdc.plus(usdcVolume);
  } else {
    asset.buyVolume = asset.buyVolume.plus(rwaVolume);
    asset.buyVolumeUsdc = asset.buyVolumeUsdc.plus(usdcVolume);
  }
  asset.save();

  const p = protocol();
  p.tradeCount += 1;
  p.lastTradeAt = event.block.timestamp;
  if (event.params.isExit) p.exitVolumeUsdc = p.exitVolumeUsdc.plus(usdcVolume);
  else p.buyVolumeUsdc = p.buyVolumeUsdc.plus(usdcVolume);
  p.save();

  const pDay = protocolDay(event.block.timestamp);
  pDay.tradeCount += 1;
  if (event.params.isExit) pDay.exitVolumeUsdc = pDay.exitVolumeUsdc.plus(usdcVolume);
  else pDay.buyVolumeUsdc = pDay.buyVolumeUsdc.plus(usdcVolume);
  pDay.save();

  const aDay = assetDay(asset, event.block.timestamp);
  aDay.tradeCount += 1;
  aDay.sumRateVsNavBps = aDay.sumRateVsNavBps.plus(event.params.rateVsNavBps);
  if (event.params.isExit) aDay.exitVolumeUsdc = aDay.exitVolumeUsdc.plus(usdcVolume);
  else aDay.buyVolumeUsdc = aDay.buyVolumeUsdc.plus(usdcVolume);
  aDay.save();
}
