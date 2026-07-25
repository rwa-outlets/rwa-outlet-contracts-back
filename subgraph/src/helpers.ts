import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";

import {
  Account,
  Asset,
  AssetDayData,
  Protocol,
  ProtocolDayData,
  Strategy,
  V4Pool,
} from "../generated/schema";
import { RWAToken } from "../generated/NavOracle/RWAToken";
import { USDC } from "./addresses";

export const ZERO = BigInt.zero();
export const ONE = BigInt.fromI32(1);
export const BPS = BigInt.fromI32(10_000);

export function eventId(event: ethereum.Event): Bytes {
  return event.transaction.hash.concatI32(event.logIndex.toI32());
}

export function protocol(): Protocol {
  let p = Protocol.load("1");
  if (p == null) {
    p = new Protocol("1");
    p.network = "sepolia";
    p.tradeCount = 0;
    p.fillCount = 0;
    p.exitVolumeUsdc = ZERO;
    p.buyVolumeUsdc = ZERO;
    p.kycHolderCount = 0;
    p.activeStrategyCount = 0;
    p.faucetDripCount = 0;
  }
  return p;
}

/// Creates the Asset entity lazily, reading ERC-20 metadata onchain the first time.
export function ensureAsset(address: Address): Asset {
  let asset = Asset.load(address);
  if (asset != null) return asset;

  asset = new Asset(address);
  const erc20 = RWAToken.bind(address);
  const symbol = erc20.try_symbol();
  asset.symbol = symbol.reverted ? "?" : symbol.value;
  const name = erc20.try_name();
  asset.name = name.reverted ? "" : name.value;
  const decimals = erc20.try_decimals();
  asset.decimals = decimals.reverted ? 18 : decimals.value;
  asset.kind = address.toHexString() == USDC ? "STABLE" : "RWA";
  asset.gated = false;
  asset.tradeCount = 0;
  asset.exitVolume = ZERO;
  asset.exitVolumeUsdc = ZERO;
  asset.buyVolume = ZERO;
  asset.buyVolumeUsdc = ZERO;
  asset.save();
  return asset;
}

export function ensureAccount(address: Bytes, timestamp: BigInt): Account {
  let account = Account.load(address);
  if (account == null) {
    account = new Account(address);
    account.firstSeenAt = timestamp;
    account.save();
  }
  return account;
}

/// An Aqua strategy may first be seen from Shipped, Pushed, PoolCreated, Trade,
/// StrategyRegistered, or Swapped — whichever comes first creates it.
export function ensureStrategy(hash: Bytes, maker: Bytes, app: Bytes, timestamp: BigInt): Strategy {
  let strategy = Strategy.load(hash);
  if (strategy != null) return strategy;

  strategy = new Strategy(hash);
  strategy.maker = maker;
  strategy.app = app;
  strategy.source = "EXTERNAL";
  strategy.kind = "UNKNOWN";
  strategy.active = false;
  strategy.listedOnRouter = false;
  strategy.tokens = [];
  strategy.tradeCount = 0;
  strategy.exitVolumeUsdc = ZERO;
  strategy.buyVolumeUsdc = ZERO;
  strategy.save();
  return strategy;
}

export function ensureV4Pool(poolId: Bytes, timestamp: BigInt): V4Pool {
  let pool = V4Pool.load(poolId);
  if (pool == null) {
    pool = new V4Pool(poolId);
    pool.lastSqrtPriceX96 = ZERO;
    pool.lastRate1e18 = ZERO;
    pool.observationCount = 0;
    pool.lastObservationAt = timestamp;
    pool.save();
  }
  return pool;
}

export function dayNumber(timestamp: BigInt): i32 {
  return timestamp.toI32() / 86400;
}

export function protocolDay(timestamp: BigInt): ProtocolDayData {
  const day = dayNumber(timestamp);
  const id = day.toString();
  let data = ProtocolDayData.load(id);
  if (data == null) {
    data = new ProtocolDayData(id);
    data.date = day * 86400;
    data.tradeCount = 0;
    data.exitVolumeUsdc = ZERO;
    data.buyVolumeUsdc = ZERO;
  }
  return data;
}

export function assetDay(asset: Asset, timestamp: BigInt): AssetDayData {
  const day = dayNumber(timestamp);
  const id = asset.id.toHexString() + "-" + day.toString();
  let data = AssetDayData.load(id);
  if (data == null) {
    data = new AssetDayData(id);
    data.asset = asset.id;
    data.date = day * 86400;
    data.tradeCount = 0;
    data.exitVolumeUsdc = ZERO;
    data.buyVolumeUsdc = ZERO;
    data.sumRateVsNavBps = ZERO;
  }
  return data;
}
