import {
  GuardSet,
  InstantExit,
  PatientEnqueued,
  Purchase,
  StrategyDelisted,
  StrategyRegistered,
} from "../generated/OutletRouter/OutletRouter";
import { PatientEnqueue, RouterListing, RouterSwap, TwapGuard } from "../generated/schema";
import { ensureAccount, ensureAsset, ensureStrategy, ensureV4Pool, eventId } from "./helpers";

export function handleStrategyRegistered(event: StrategyRegistered): void {
  const asset = ensureAsset(event.params.asset);

  let listing = RouterListing.load(event.params.orderHash);
  if (listing == null) listing = new RouterListing(event.params.orderHash);
  listing.asset = asset.id;
  listing.maker = event.params.maker;
  listing.registrar = event.params.registrar;
  listing.active = true;
  listing.registeredAt = event.block.timestamp;
  listing.delistedAt = null;
  listing.save();

  const strategy = ensureStrategy(
    event.params.orderHash,
    event.params.maker,
    event.address,
    event.block.timestamp
  );
  strategy.maker = event.params.maker;
  strategy.listedOnRouter = true;
  strategy.registrar = event.params.registrar;
  if (strategy.asset === null) strategy.asset = asset.id;
  strategy.save();
}

export function handleStrategyDelisted(event: StrategyDelisted): void {
  const listing = RouterListing.load(event.params.orderHash);
  if (listing != null) {
    listing.active = false;
    listing.delistedAt = event.block.timestamp;
    listing.save();
  }
  const strategy = ensureStrategy(
    event.params.orderHash,
    event.address,
    event.address,
    event.block.timestamp
  );
  strategy.listedOnRouter = false;
  strategy.save();
}

export function handleGuardSet(event: GuardSet): void {
  const asset = ensureAsset(event.params.asset);
  let guard = TwapGuard.load(event.params.asset);
  if (guard == null) guard = new TwapGuard(event.params.asset);
  guard.asset = asset.id;
  guard.source = event.params.source;
  guard.poolId = event.params.poolId;
  guard.window = event.params.window;
  guard.bandBps = event.params.bandBps;
  guard.updatedAt = event.block.timestamp;
  guard.save();

  // links the v4 pool to the asset so hook observations can be priced/attributed
  const pool = ensureV4Pool(event.params.poolId, event.block.timestamp);
  pool.asset = asset.id;
  pool.save();
}

export function handleInstantExit(event: InstantExit): void {
  const asset = ensureAsset(event.params.asset);
  const account = ensureAccount(event.params.user, event.block.timestamp);
  const strategy = ensureStrategy(
    event.params.orderHash,
    event.address,
    event.address,
    event.block.timestamp
  );

  const swap = new RouterSwap(eventId(event));
  swap.kind = "INSTANT_EXIT";
  swap.asset = asset.id;
  swap.user = account.id;
  swap.strategy = strategy.id;
  swap.amountIn = event.params.assetIn;
  swap.amountOut = event.params.usdcOut;
  swap.timestamp = event.block.timestamp;
  swap.txHash = event.transaction.hash;
  swap.save();
}

export function handlePurchase(event: Purchase): void {
  const asset = ensureAsset(event.params.asset);
  const account = ensureAccount(event.params.user, event.block.timestamp);
  const strategy = ensureStrategy(
    event.params.orderHash,
    event.address,
    event.address,
    event.block.timestamp
  );

  const swap = new RouterSwap(eventId(event));
  swap.kind = "PURCHASE";
  swap.asset = asset.id;
  swap.user = account.id;
  swap.strategy = strategy.id;
  swap.amountIn = event.params.usdcIn;
  swap.amountOut = event.params.assetOut;
  swap.timestamp = event.block.timestamp;
  swap.txHash = event.transaction.hash;
  swap.save();
}

export function handlePatientEnqueued(event: PatientEnqueued): void {
  const asset = ensureAsset(event.params.asset);
  const account = ensureAccount(event.params.user, event.block.timestamp);

  const enqueue = new PatientEnqueue(eventId(event));
  enqueue.asset = asset.id;
  enqueue.user = account.id;
  enqueue.epochNumber = event.params.epoch;
  enqueue.shares = event.params.shares;
  enqueue.timestamp = event.block.timestamp;
  enqueue.txHash = event.transaction.hash;
  enqueue.save();
}
