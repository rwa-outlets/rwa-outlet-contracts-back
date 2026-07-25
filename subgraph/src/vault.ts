import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";

import {
  CuratorVault as CuratorVaultContract,
  Deposit,
  EpochFulfilled,
  MandateAssetAdded,
  OperatorSet,
  PoolCreated,
  PoolDocked,
  QueueClaimed,
  Recycled,
  RedeemRequest,
  RolesSet,
  Transfer,
  Withdraw,
} from "../generated/CuratorVaultExpress/CuratorVault";
import {
  MandateAsset,
  OperatorApproval,
  RecycleAction,
  Vault,
  VaultClaim,
  VaultController,
  VaultDeposit,
  VaultEpoch,
  VaultPosition,
  VaultQueueClaim,
  VaultRedeemRequest,
} from "../generated/schema";
import { ensureAccount, ensureAsset, ensureStrategy, eventId, ONE, ZERO } from "./helpers";
import { SWAP_VM } from "./addresses";

const E30 = BigInt.fromI32(10).pow(30);
const E18 = BigInt.fromI32(10).pow(18);

function ensureVault(address: Address, timestamp: BigInt): Vault {
  let vault = Vault.load(address);
  if (vault != null) return vault;

  const contract = CuratorVaultContract.bind(address);
  vault = new Vault(address);
  const name = contract.try_name();
  vault.name = name.reverted ? "" : name.value;
  const symbol = contract.try_symbol();
  vault.symbol = symbol.reverted ? "?" : symbol.value;
  const curator = contract.try_curator();
  vault.curator = curator.reverted ? Address.zero() : curator.value;
  const treasury = contract.try_curatorTreasury();
  vault.curatorTreasury = treasury.reverted ? Address.zero() : treasury.value;
  const feeBps = contract.try_curatorFeeBps();
  vault.curatorFeeBps = feeBps.reverted ? 0 : feeBps.value;
  const floorBps = contract.try_maxDiscountFloorBps();
  vault.maxDiscountFloorBps = floorBps.reverted ? 0 : floorBps.value;

  vault.totalShares = ZERO;
  vault.idleUsdc = ZERO;
  vault.reservedAssets = ZERO;
  vault.currentEpoch = ONE;
  vault.totalDeposited = ZERO;
  vault.totalWithdrawn = ZERO;
  vault.pendingShares = ZERO;
  vault.lastSharePrice = E18; // 1.0 USDC per share before the first deposit
  vault.depositCount = 0;
  vault.save();
  return vault;
}

function epochId(vault: Vault, epochNumber: BigInt): string {
  return vault.id.toHexString() + "-" + epochNumber.toString();
}

function ensureEpoch(vault: Vault, epochNumber: BigInt, timestamp: BigInt): VaultEpoch {
  const id = epochId(vault, epochNumber);
  let epoch = VaultEpoch.load(id);
  if (epoch == null) {
    epoch = new VaultEpoch(id);
    epoch.vault = vault.id;
    epoch.epochNumber = epochNumber;
    epoch.status = "OPEN";
    epoch.totalShares = ZERO;
    epoch.sharesClaimed = ZERO;
    epoch.firstRequestAt = timestamp;
    epoch.save();
  }
  return epoch;
}

function ensurePosition(vault: Vault, holder: Bytes, timestamp: BigInt): VaultPosition {
  const id = vault.id.concat(holder);
  let position = VaultPosition.load(id);
  if (position == null) {
    position = new VaultPosition(id);
    position.vault = vault.id;
    position.holder = holder;
    position.shares = ZERO;
    position.depositedAssets = ZERO;
    position.withdrawnAssets = ZERO;
  }
  position.updatedAt = timestamp;
  return position;
}

// USDC-per-share ×1e18: assets are 6-decimals USDC, shares 18-decimals
function sharePrice(assets: BigInt, shares: BigInt): BigInt {
  if (shares.equals(ZERO)) return E18;
  return assets.times(E30).div(shares);
}

// ------------------------------------------------------------------ LP flows

export function handleDeposit(event: Deposit): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const owner = ensureAccount(event.params.owner, event.block.timestamp);

  const deposit = new VaultDeposit(eventId(event));
  deposit.vault = vault.id;
  deposit.sender = event.params.sender;
  deposit.owner = owner.id;
  deposit.assets = event.params.assets;
  deposit.shares = event.params.shares;
  deposit.sharePrice = sharePrice(event.params.assets, event.params.shares);
  deposit.timestamp = event.block.timestamp;
  deposit.txHash = event.transaction.hash;
  deposit.save();

  vault.totalDeposited = vault.totalDeposited.plus(event.params.assets);
  vault.depositCount += 1;
  vault.lastSharePrice = deposit.sharePrice;
  vault.save();

  const position = ensurePosition(vault, event.params.owner, event.block.timestamp);
  position.depositedAssets = position.depositedAssets.plus(event.params.assets);
  position.save();
}

export function handleRedeemRequest(event: RedeemRequest): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const epochNumber = event.params.requestId;
  const epoch = ensureEpoch(vault, epochNumber, event.block.timestamp);
  const controller = ensureAccount(event.params.controller, event.block.timestamp);

  epoch.totalShares = epoch.totalShares.plus(event.params.shares);
  epoch.save();

  vault.pendingShares = vault.pendingShares.plus(event.params.shares);
  vault.currentEpoch = epochNumber;
  vault.save();

  const requestId = epochId(vault, epochNumber) + "-" + event.params.controller.toHexString();
  let request = VaultRedeemRequest.load(requestId);
  if (request == null) {
    request = new VaultRedeemRequest(requestId);
    request.vault = vault.id;
    request.epoch = epoch.id;
    request.epochNumber = epochNumber;
    request.controller = controller.id;
    request.shares = ZERO;
    request.sharesClaimed = ZERO;
    request.firstRequestAt = event.block.timestamp;

    const controllerId = vault.id.toHexString() + "-" + event.params.controller.toHexString();
    let fifo = VaultController.load(controllerId);
    if (fifo == null) {
      fifo = new VaultController(controllerId);
      fifo.vault = vault.id;
      fifo.controller = event.params.controller;
      fifo.epochNumbers = [];
      fifo.cursor = 0;
    }
    const epochs = fifo.epochNumbers;
    epochs.push(epochNumber);
    fifo.epochNumbers = epochs;
    fifo.save();
  }
  request.shares = request.shares.plus(event.params.shares);
  request.lastRequestAt = event.block.timestamp;
  request.save();
}

export function handleEpochFulfilled(event: EpochFulfilled): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const epoch = ensureEpoch(vault, event.params.epoch, event.block.timestamp);
  epoch.status = "FULFILLED";
  epoch.totalAssets = event.params.assets;
  epoch.fulfilledAt = event.block.timestamp;
  epoch.save();

  vault.pendingShares = vault.pendingShares.minus(event.params.shares);
  vault.reservedAssets = vault.reservedAssets.plus(event.params.assets);
  vault.currentEpoch = event.params.epoch.plus(ONE);
  vault.lastSharePrice = sharePrice(event.params.assets, event.params.shares);
  vault.save();
}

export function handleWithdraw(event: Withdraw): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const controllerAddress = event.params.controller;
  ensureAccount(controllerAddress, event.block.timestamp);

  const claim = new VaultClaim(eventId(event));
  claim.vault = vault.id;
  claim.sender = event.params.sender;
  claim.receiver = event.params.receiver;
  claim.controller = controllerAddress;
  claim.assets = event.params.assets;
  claim.shares = event.params.shares;
  claim.timestamp = event.block.timestamp;
  claim.txHash = event.transaction.hash;
  claim.save();

  // FIFO attribution across fulfilled epochs, mirroring the contract cursor
  let remaining = event.params.shares;
  const controllerId = vault.id.toHexString() + "-" + controllerAddress.toHexString();
  const fifo = VaultController.load(controllerId);
  if (fifo != null) {
    let cursor = fifo.cursor;
    const epochs = fifo.epochNumbers;
    while (remaining.gt(ZERO) && cursor < epochs.length) {
      const epoch = VaultEpoch.load(epochId(vault, epochs[cursor]));
      if (epoch == null || epoch.status != "FULFILLED") break;
      const request = VaultRedeemRequest.load(epoch.id + "-" + controllerAddress.toHexString());
      if (request == null) {
        cursor += 1;
        continue;
      }
      const available = request.shares.minus(request.sharesClaimed);
      if (available.equals(ZERO)) {
        cursor += 1;
        continue;
      }
      const take = available.lt(remaining) ? available : remaining;
      request.sharesClaimed = request.sharesClaimed.plus(take);
      epoch.sharesClaimed = epoch.sharesClaimed.plus(take);
      remaining = remaining.minus(take);
      if (take.equals(available)) cursor += 1;
      request.save();
      epoch.save();
    }
    fifo.cursor = cursor;
    fifo.save();
  }

  vault.reservedAssets = vault.reservedAssets.minus(event.params.assets);
  vault.totalWithdrawn = vault.totalWithdrawn.plus(event.params.assets);
  vault.save();

  const position = ensurePosition(vault, controllerAddress, event.block.timestamp);
  position.withdrawnAssets = position.withdrawnAssets.plus(event.params.assets);
  position.save();
}

export function handleOperatorSet(event: OperatorSet): void {
  const id = event.address.concat(event.params.controller).concat(event.params.operator);
  let approval = OperatorApproval.load(id);
  if (approval == null) {
    approval = new OperatorApproval(id);
    approval.contract = event.address;
    approval.controller = event.params.controller;
    approval.operator = event.params.operator;
  }
  approval.approved = event.params.approved;
  approval.updatedAt = event.block.timestamp;
  approval.save();
}

/// Vault share ERC-20 transfers: supply from mints/burns, per-holder positions
/// (the vault's own address holds epoch-escrowed shares).
export function handleShareTransfer(event: Transfer): void {
  const vault = ensureVault(event.address, event.block.timestamp);

  if (event.params.from.equals(Address.zero())) {
    vault.totalShares = vault.totalShares.plus(event.params.value);
    vault.save();
  } else {
    const position = ensurePosition(vault, event.params.from, event.block.timestamp);
    position.shares = position.shares.minus(event.params.value);
    position.save();
  }

  if (event.params.to.equals(Address.zero())) {
    vault.totalShares = vault.totalShares.minus(event.params.value);
    vault.save();
  } else {
    const position = ensurePosition(vault, event.params.to, event.block.timestamp);
    position.shares = position.shares.plus(event.params.value);
    position.save();
  }
}

// ------------------------------------------------------------- curator ops

export function handleMandateAssetAdded(event: MandateAssetAdded): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const asset = ensureAsset(event.params.asset);

  const id = vault.id.toHexString() + "-" + event.params.asset.toHexString();
  let mandate = MandateAsset.load(id);
  if (mandate == null) {
    mandate = new MandateAsset(id);
    mandate.vault = vault.id;
    mandate.asset = asset.id;
    mandate.queuedShares = ZERO;
    mandate.addedAt = event.block.timestamp;
  }
  mandate.queue = event.params.queue.equals(Address.zero()) ? null : event.params.queue;
  mandate.perAssetCap = event.params.perAssetCap;
  mandate.save();
}

export function handlePoolCreated(event: PoolCreated): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const asset = ensureAsset(event.params.asset);

  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.address,
    Address.fromString(SWAP_VM),
    event.block.timestamp
  );
  strategy.source = "VAULT_POOL";
  strategy.vault = vault.id;
  strategy.asset = asset.id;

  const kind = event.params.kind; // 0 Express, 1 Patient, 2 Market
  if (kind == 0) {
    strategy.kind = "EXPRESS";
    const decoded = ethereum.decode("(uint16,uint32,uint256,uint256)", event.params.params);
    if (decoded != null) {
      const tuple = decoded.toTuple();
      strategy.spreadBps = tuple[0].toBigInt().toI32();
      strategy.navMaxStaleness = tuple[1].toBigInt();
    }
  } else if (kind == 1) {
    strategy.kind = "PATIENT";
    const decoded = ethereum.decode("(uint16,uint16,uint40,uint32,uint32,uint256)", event.params.params);
    if (decoded != null) {
      const tuple = decoded.toTuple();
      strategy.startBps = tuple[0].toBigInt().toI32();
      strategy.floorBps = tuple[1].toBigInt().toI32();
      strategy.auctionStartTime = tuple[2].toBigInt();
      strategy.auctionDuration = tuple[3].toBigInt();
      strategy.navMaxStaleness = tuple[4].toBigInt();
    }
  } else {
    strategy.kind = "MARKET";
    const decoded = ethereum.decode("(uint16,uint32,uint256,uint256)", event.params.params);
    if (decoded != null) {
      const tuple = decoded.toTuple();
      strategy.bandBps = tuple[0].toBigInt().toI32();
      strategy.navMaxStaleness = tuple[1].toBigInt();
    }
  }
  strategy.save();
}

export function handlePoolDocked(event: PoolDocked): void {
  const strategy = ensureStrategy(
    event.params.strategyHash,
    event.address,
    Address.fromString(SWAP_VM),
    event.block.timestamp
  );
  strategy.active = false; // Aqua.Docked of the same tx keeps counters/balances in sync
  strategy.dockedAt = event.block.timestamp;
  strategy.save();
}

export function handleRecycled(event: Recycled): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const asset = ensureAsset(event.params.asset);

  const action = new RecycleAction(eventId(event));
  action.vault = vault.id;
  action.asset = asset.id;
  action.shares = event.params.shares;
  action.queueEpochNumber = event.params.queueEpoch;
  action.timestamp = event.block.timestamp;
  action.txHash = event.transaction.hash;
  action.save();

  const mandate = MandateAsset.load(vault.id.toHexString() + "-" + event.params.asset.toHexString());
  if (mandate != null) {
    mandate.queuedShares = mandate.queuedShares.plus(event.params.shares);
    mandate.save();
  }
}

export function handleQueueClaimed(event: QueueClaimed): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  const asset = ensureAsset(event.params.asset);

  const claim = new VaultQueueClaim(eventId(event));
  claim.vault = vault.id;
  claim.asset = asset.id;
  claim.shares = event.params.shares;
  claim.proceeds = event.params.proceeds;
  claim.curatorFee = event.params.curatorFee;
  claim.timestamp = event.block.timestamp;
  claim.txHash = event.transaction.hash;
  claim.save();

  const mandate = MandateAsset.load(vault.id.toHexString() + "-" + event.params.asset.toHexString());
  if (mandate != null) {
    mandate.queuedShares = mandate.queuedShares.minus(event.params.shares);
    mandate.save();
  }
}

export function handleRolesSet(event: RolesSet): void {
  const vault = ensureVault(event.address, event.block.timestamp);
  vault.curator = event.params.curator;
  vault.curatorTreasury = event.params.curatorTreasury;
  vault.save();
}
