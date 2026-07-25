import { Address, BigInt } from "@graphprotocol/graph-ts";

import {
  FeesClaimed,
  OperatorSet,
  RedeemRequest,
  RedemptionQueue as RedemptionQueueContract,
  RolesSet,
  Settled,
  Submitted,
  Withdraw,
} from "../generated/RedemptionQueueTbill/RedemptionQueue";
import { OperatorApproval, Queue, QueueClaim, QueueController, QueueEpoch, QueueRequest } from "../generated/schema";
import { ensureAccount, ensureAsset, eventId, ONE, ZERO } from "./helpers";
import { USDC } from "./addresses";

function ensureQueue(address: Address, timestamp: BigInt): Queue {
  let queue = Queue.load(address);
  if (queue != null) return queue;

  const contract = RedemptionQueueContract.bind(address);
  queue = new Queue(address);

  const share = contract.try_share();
  const rwa = share.reverted ? Address.zero() : share.value;
  queue.asset = ensureAsset(rwa).id;
  const usdc = contract.try_asset();
  queue.usdc = usdc.reverted ? Address.fromString(USDC) : usdc.value;
  const curator = contract.try_curator();
  queue.curator = curator.reverted ? Address.zero() : curator.value;
  const issuer = contract.try_issuer();
  queue.issuer = issuer.reverted ? Address.zero() : issuer.value;
  const feeRecipient = contract.try_feeRecipient();
  queue.feeRecipient = feeRecipient.reverted ? Address.zero() : feeRecipient.value;
  const feeBps = contract.try_queueFeeBps();
  queue.queueFeeBps = feeBps.reverted ? 0 : feeBps.value;
  const window = contract.try_issuerWindow();
  queue.issuerWindow = window.reverted ? ZERO : window.value;

  queue.currentEpoch = ONE;
  queue.lastSettledEpoch = ZERO;
  queue.lastSettledNav = ZERO;
  queue.pendingShares = ZERO;
  queue.claimableShares = ZERO;
  queue.totalSharesRequested = ZERO;
  queue.totalAssetsSettled = ZERO;
  queue.totalAssetsClaimed = ZERO;
  queue.totalFeesClaimed = ZERO;
  queue.requestCount = 0;
  queue.save();
  return queue;
}

function epochId(queue: Queue, epochNumber: BigInt): string {
  return queue.id.toHexString() + "-" + epochNumber.toString();
}

function ensureEpoch(queue: Queue, epochNumber: BigInt, timestamp: BigInt): QueueEpoch {
  const id = epochId(queue, epochNumber);
  let epoch = QueueEpoch.load(id);
  if (epoch == null) {
    epoch = new QueueEpoch(id);
    epoch.queue = queue.id;
    epoch.epochNumber = epochNumber;
    epoch.status = "OPEN";
    epoch.totalShares = ZERO;
    epoch.sharesClaimed = ZERO;
    epoch.firstRequestAt = timestamp;
    epoch.save();
  }
  return epoch;
}

export function handleRedeemRequest(event: RedeemRequest): void {
  const queue = ensureQueue(event.address, event.block.timestamp);
  const epochNumber = event.params.requestId;
  const epoch = ensureEpoch(queue, epochNumber, event.block.timestamp);
  const controller = ensureAccount(event.params.controller, event.block.timestamp);

  epoch.totalShares = epoch.totalShares.plus(event.params.shares);
  epoch.save();

  queue.pendingShares = queue.pendingShares.plus(event.params.shares);
  queue.totalSharesRequested = queue.totalSharesRequested.plus(event.params.shares);
  queue.requestCount += 1;
  queue.currentEpoch = epochNumber;
  queue.save();

  const requestId = epochId(queue, epochNumber) + "-" + event.params.controller.toHexString();
  let request = QueueRequest.load(requestId);
  if (request == null) {
    request = new QueueRequest(requestId);
    request.queue = queue.id;
    request.epoch = epoch.id;
    request.epochNumber = epochNumber;
    request.controller = controller.id;
    request.shares = ZERO;
    request.sharesClaimed = ZERO;
    request.firstRequestAt = event.block.timestamp;

    // FIFO bookkeeping mirrors the contract's per-controller epoch list
    const controllerId = queue.id.toHexString() + "-" + event.params.controller.toHexString();
    let fifo = QueueController.load(controllerId);
    if (fifo == null) {
      fifo = new QueueController(controllerId);
      fifo.queue = queue.id;
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

export function handleSubmitted(event: Submitted): void {
  const queue = ensureQueue(event.address, event.block.timestamp);
  const epoch = ensureEpoch(queue, event.params.epoch, event.block.timestamp);
  epoch.status = "SUBMITTED";
  epoch.submittedAt = event.block.timestamp;
  epoch.save();

  queue.currentEpoch = event.params.epoch.plus(ONE);
  queue.save();
}

export function handleSettled(event: Settled): void {
  const queue = ensureQueue(event.address, event.block.timestamp);
  const epoch = ensureEpoch(queue, event.params.epoch, event.block.timestamp);
  epoch.status = "SETTLED";
  epoch.navAtSettle = event.params.navAtSettle;
  epoch.assetsIn = event.params.assetsIn;
  epoch.settledAt = event.block.timestamp;
  epoch.save();

  queue.pendingShares = queue.pendingShares.minus(epoch.totalShares);
  queue.claimableShares = queue.claimableShares.plus(epoch.totalShares);
  queue.lastSettledEpoch = event.params.epoch;
  queue.lastSettledNav = event.params.navAtSettle;
  queue.totalAssetsSettled = queue.totalAssetsSettled.plus(event.params.assetsIn);
  queue.save();
}

/// The claim leg consumes settled epochs FIFO per controller — replayed here to attribute
/// claimed shares to epochs exactly like the contract's cursor.
export function handleWithdraw(event: Withdraw): void {
  const queue = ensureQueue(event.address, event.block.timestamp);
  const controllerAddress = event.params.owner; // ERC-7540 names the controller "owner"
  ensureAccount(controllerAddress, event.block.timestamp);

  const claim = new QueueClaim(eventId(event));
  claim.queue = queue.id;
  claim.sender = event.params.sender;
  claim.receiver = event.params.receiver;
  claim.controller = controllerAddress;
  claim.assets = event.params.assets;
  claim.shares = event.params.shares;
  claim.timestamp = event.block.timestamp;
  claim.txHash = event.transaction.hash;
  claim.save();

  let remaining = event.params.shares;
  const controllerId = queue.id.toHexString() + "-" + controllerAddress.toHexString();
  const fifo = QueueController.load(controllerId);
  if (fifo != null) {
    let cursor = fifo.cursor;
    const epochs = fifo.epochNumbers;
    while (remaining.gt(ZERO) && cursor < epochs.length) {
      const epoch = QueueEpoch.load(epochId(queue, epochs[cursor]));
      if (epoch == null || epoch.status != "SETTLED") break;
      const request = QueueRequest.load(epoch.id + "-" + controllerAddress.toHexString());
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

  queue.claimableShares = queue.claimableShares.minus(event.params.shares.minus(remaining));
  queue.totalAssetsClaimed = queue.totalAssetsClaimed.plus(event.params.assets);
  queue.save();
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

export function handleFeesClaimed(event: FeesClaimed): void {
  const queue = ensureQueue(event.address, event.block.timestamp);
  queue.totalFeesClaimed = queue.totalFeesClaimed.plus(event.params.amount);
  queue.save();
}

export function handleRolesSet(event: RolesSet): void {
  const queue = ensureQueue(event.address, event.block.timestamp);
  queue.curator = event.params.curator;
  queue.issuer = event.params.issuer;
  queue.feeRecipient = event.params.feeRecipient;
  queue.save();
}
