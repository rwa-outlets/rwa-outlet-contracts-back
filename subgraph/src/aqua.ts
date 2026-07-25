import { BigInt, Bytes } from "@graphprotocol/graph-ts";

import { Docked, Pulled, Pushed, Shipped } from "../generated/Aqua/Aqua";
import { Asset, StrategyBalance } from "../generated/schema";
import { ensureStrategy, protocol, ZERO } from "./helpers";
import { USDC } from "./addresses";

function balanceId(strategyHash: Bytes, token: Bytes): Bytes {
  return strategyHash.concat(token);
}

export function handleShipped(event: Shipped): void {
  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.params.maker,
    event.params.app,
    event.block.timestamp
  );
  if (!strategy.active) {
    const p = protocol();
    p.activeStrategyCount += 1;
    p.save();
  }
  strategy.active = true;
  strategy.maker = event.params.maker;
  strategy.app = event.params.app;
  strategy.shippedAt = event.block.timestamp;
  strategy.save();
}

export function handleDocked(event: Docked): void {
  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.params.maker,
    event.params.app,
    event.block.timestamp
  );
  if (strategy.active) {
    const p = protocol();
    p.activeStrategyCount -= 1;
    p.save();
  }
  strategy.active = false;
  strategy.dockedAt = event.block.timestamp;
  strategy.save();

  // docking zeroes every token balance under the strategy
  const tokens = strategy.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const balance = StrategyBalance.load(balanceId(event.params.strategyHash, tokens[i]));
    if (balance != null) {
      balance.balance = ZERO;
      balance.updatedAt = event.block.timestamp;
      balance.save();
    }
  }
}

export function handlePushed(event: Pushed): void {
  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.params.maker,
    event.params.app,
    event.block.timestamp
  );

  // remember tokens so Docked can zero them
  const tokens = strategy.tokens;
  let known = false;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].equals(event.params.token)) {
      known = true;
      break;
    }
  }
  if (!known) {
    tokens.push(event.params.token);
    strategy.tokens = tokens;
  }

  // infer the strategy's RWA from its non-USDC leg (pro-maker strategies have no
  // PoolCreated); only when the token is already a tracked Asset
  if (
    strategy.asset === null &&
    event.params.token.toHexString() != USDC &&
    Asset.load(event.params.token) != null
  ) {
    strategy.asset = event.params.token;
  }
  strategy.save();

  let balance = StrategyBalance.load(balanceId(event.params.strategyHash, event.params.token));
  if (balance == null) {
    balance = new StrategyBalance(balanceId(event.params.strategyHash, event.params.token));
    balance.strategy = strategy.id;
    balance.token = event.params.token;
    balance.balance = ZERO;
    balance.pushedTotal = ZERO;
    balance.pulledTotal = ZERO;
  }
  balance.balance = balance.balance.plus(event.params.amount);
  balance.pushedTotal = balance.pushedTotal.plus(event.params.amount);
  balance.updatedAt = event.block.timestamp;
  balance.save();
}

export function handlePulled(event: Pulled): void {
  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.params.maker,
    event.params.app,
    event.block.timestamp
  );
  strategy.save();

  let balance = StrategyBalance.load(balanceId(event.params.strategyHash, event.params.token));
  if (balance == null) {
    balance = new StrategyBalance(balanceId(event.params.strategyHash, event.params.token));
    balance.strategy = strategy.id;
    balance.token = event.params.token;
    balance.balance = ZERO;
    balance.pushedTotal = ZERO;
    balance.pulledTotal = ZERO;
  }
  balance.balance = balance.balance.minus(event.params.amount);
  balance.pulledTotal = balance.pulledTotal.plus(event.params.amount);
  balance.updatedAt = event.block.timestamp;
  balance.save();
}
