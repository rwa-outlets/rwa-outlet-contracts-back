import { Address } from "@graphprotocol/graph-ts";

import { OperatorSet, Transfer } from "../generated/ComplianceNFT/ComplianceNFT";
import { ComplianceOperator, KycHolder } from "../generated/schema";
import { protocol } from "./helpers";

/// Soulbound pass: only mints (from == 0) and burns (to == 0) can occur.
export function handleTransfer(event: Transfer): void {
  const p = protocol();

  if (event.params.from.equals(Address.zero())) {
    let holder = KycHolder.load(event.params.to);
    if (holder == null) holder = new KycHolder(event.params.to);
    holder.active = true;
    holder.tokenId = event.params.tokenId;
    holder.mintedAt = event.block.timestamp;
    holder.revokedAt = null;
    holder.save();
    p.kycHolderCount += 1;
    p.save();
  } else if (event.params.to.equals(Address.zero())) {
    const holder = KycHolder.load(event.params.from);
    if (holder != null && holder.active) {
      holder.active = false;
      holder.revokedAt = event.block.timestamp;
      holder.save();
      p.kycHolderCount -= 1;
      p.save();
    }
  }
}

export function handleOperatorSet(event: OperatorSet): void {
  let operator = ComplianceOperator.load(event.params.operator);
  if (operator == null) operator = new ComplianceOperator(event.params.operator);
  operator.allowed = event.params.allowed;
  operator.updatedAt = event.block.timestamp;
  operator.save();
}
