import { KeeperSet, NavUpdated } from "../generated/NavOracle/NavOracle";
import { NavPoint, OracleKeeper } from "../generated/schema";
import { assetDay, ensureAsset, eventId } from "./helpers";

export function handleNavUpdated(event: NavUpdated): void {
  const asset = ensureAsset(event.params.asset);
  asset.nav = event.params.nav;
  asset.navUpdatedAt = event.params.timestamp;
  asset.save();

  const point = new NavPoint(eventId(event));
  point.asset = asset.id;
  point.nav = event.params.nav;
  point.timestamp = event.params.timestamp;
  point.block = event.block.number;
  point.txHash = event.transaction.hash;
  point.save();

  const day = assetDay(asset, event.block.timestamp);
  day.navClose = event.params.nav;
  const min = day.navMin;
  if (min === null || event.params.nav.lt(min)) day.navMin = event.params.nav;
  const max = day.navMax;
  if (max === null || event.params.nav.gt(max)) day.navMax = event.params.nav;
  day.save();
}

export function handleKeeperSet(event: KeeperSet): void {
  let keeper = OracleKeeper.load(event.params.keeper);
  if (keeper == null) keeper = new OracleKeeper(event.params.keeper);
  keeper.allowed = event.params.allowed;
  keeper.updatedAt = event.block.timestamp;
  keeper.save();
}
