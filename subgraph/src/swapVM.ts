import { Swapped } from "../generated/AquaSwapVMRouter/AquaSwapVMRouter";
import { Asset, Fill, Trade, _TxOrderTrade } from "../generated/schema";
import { ensureStrategy, eventId, protocol } from "./helpers";
import { USDC } from "./addresses";

/// Official router settlement event. Fired once per swap, after the program (and therefore
/// after any NavExtruction.Trade of the same tx) — used to link fills to trades and as the
/// volume source for strategies whose program carries no extruction.
export function handleSwapped(event: Swapped): void {
  const strategy = ensureStrategy(
    event.params.orderHash,
    event.params.maker,
    event.address,
    event.block.timestamp
  );

  const fill = new Fill(eventId(event));
  fill.strategy = strategy.id;
  fill.maker = event.params.maker;
  fill.taker = event.params.taker;
  fill.tokenIn = event.params.tokenIn;
  fill.tokenOut = event.params.tokenOut;
  fill.amountIn = event.params.amountIn;
  fill.amountOut = event.params.amountOut;
  fill.timestamp = event.block.timestamp;
  fill.txHash = event.transaction.hash;

  const p = protocol();
  p.fillCount += 1;

  const link = _TxOrderTrade.load(event.transaction.hash.concat(event.params.orderHash));
  if (link != null) {
    // pricing context already captured by the NavExtruction.Trade of this tx
    fill.trade = link.trade;
    const trade = Trade.load(link.trade);
    if (trade != null) {
      trade.fill = fill.id;
      trade.save();
    }
  } else {
    // extruction-less strategy — aggregate volumes here instead
    const isExit = event.params.tokenOut.toHexString() == USDC;
    const isBuy = event.params.tokenIn.toHexString() == USDC;
    strategy.tradeCount += 1;
    strategy.lastTradeAt = event.block.timestamp;
    if (isExit) {
      strategy.exitVolumeUsdc = strategy.exitVolumeUsdc.plus(event.params.amountOut);
      p.exitVolumeUsdc = p.exitVolumeUsdc.plus(event.params.amountOut);
    } else if (isBuy) {
      strategy.buyVolumeUsdc = strategy.buyVolumeUsdc.plus(event.params.amountIn);
      p.buyVolumeUsdc = p.buyVolumeUsdc.plus(event.params.amountIn);
    }
    const rwaToken = isExit ? event.params.tokenIn : event.params.tokenOut;
    const asset = Asset.load(rwaToken);
    if (asset != null) {
      asset.tradeCount += 1;
      asset.lastTradeAt = event.block.timestamp;
      if (isExit) {
        asset.exitVolume = asset.exitVolume.plus(event.params.amountIn);
        asset.exitVolumeUsdc = asset.exitVolumeUsdc.plus(event.params.amountOut);
      } else if (isBuy) {
        asset.buyVolume = asset.buyVolume.plus(event.params.amountOut);
        asset.buyVolumeUsdc = asset.buyVolumeUsdc.plus(event.params.amountIn);
      }
      asset.save();
    }
    strategy.save();
  }

  fill.save();
  p.save();
}
