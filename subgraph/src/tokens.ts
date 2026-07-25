import { Address, BigInt } from "@graphprotocol/graph-ts";

import { GatedSet, Transfer } from "../generated/TestUSDC/RWAToken";
import { TokenBalance, Vault } from "../generated/schema";
import { ensureAsset, ZERO } from "./helpers";
import { USDC } from "./addresses";

/// ERC-20 transfers of the tracked tokens (USDC + RWAs): exact wallet balances for every
/// holder — vault idle cash, queue escrow, maker inventory, faucet distribution.
export function handleTransfer(event: Transfer): void {
  ensureAsset(event.address);

  if (!event.params.from.equals(Address.zero())) {
    applyDelta(event.address, event.params.from, event.params.value.neg(), event.block.timestamp);
  }
  if (!event.params.to.equals(Address.zero())) {
    applyDelta(event.address, event.params.to, event.params.value, event.block.timestamp);
  }
}

function applyDelta(token: Address, holder: Address, delta: BigInt, timestamp: BigInt): void {
  const id = token.concat(holder);
  let balance = TokenBalance.load(id);
  if (balance == null) {
    balance = new TokenBalance(id);
    balance.token = token;
    balance.holder = holder;
    balance.balance = ZERO;
  }
  balance.balance = balance.balance.plus(delta);
  balance.updatedAt = timestamp;
  balance.save();

  // convenience mirror: a curator vault's idle (wallet) USDC
  if (token.toHexString() == USDC) {
    const vault = Vault.load(holder);
    if (vault != null) {
      vault.idleUsdc = balance.balance;
      vault.save();
    }
  }
}

export function handleGatedSet(event: GatedSet): void {
  const asset = ensureAsset(event.address);
  asset.gated = event.params.gated;
  asset.save();
}
