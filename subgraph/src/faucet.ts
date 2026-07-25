import { Dripped } from "../generated/Faucet/Faucet";
import { FaucetDrip } from "../generated/schema";
import { ensureAccount, eventId, protocol } from "./helpers";

export function handleDripped(event: Dripped): void {
  const account = ensureAccount(event.params.to, event.block.timestamp);

  const drip = new FaucetDrip(eventId(event));
  drip.to = account.id;
  drip.caller = event.params.caller;
  drip.timestamp = event.block.timestamp;
  drip.txHash = event.transaction.hash;
  drip.save();

  const p = protocol();
  p.faucetDripCount += 1;
  p.save();
}
