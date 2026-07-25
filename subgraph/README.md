# RWA Outlets — Subgraph

The Graph indexer over the RWA Outlets engine on **Ethereum Sepolia** (addresses in
`rwa-outlet-contracts-core/deployments/11155111.json`). This is the *only* chain-state
source the AI curator agent reads — every decision is a subgraph query → reasoning →
onchain action, per `docs/02-engine-spec.md` §7 (data flows one way).

**Live deployment** — Studio slug `rwa-outlet-contracts-core`:

- Studio: <https://thegraph.com/studio/subgraph/rwa-outlet-contracts-core>
- Query endpoint: `https://api.studio.thegraph.com/query/1756992/rwa-outlet-contracts-core/<version>`
  (current version `v0.2.1`; use `/version/latest` once the subgraph is published)

## What is indexed

| Data source | Events | Entities |
|---|---|---|
| `Aqua` (official) | `Shipped`, `Docked`, `Pushed`, `Pulled` | `Strategy`, `StrategyBalance` — live virtual inventory per pool |
| `AquaSwapVMRouter` (official) | `Swapped` | `Fill` (linked to the same-tx `Trade`) |
| `NavExtruction` | `Trade` | `Trade` — full pricing context: pool id, direction, `rateVsNavBps`, NAV at execution |
| `NavOracle` | `NavUpdated`, `KeeperSet` | `Asset.nav`, `NavPoint` history, `OracleKeeper` |
| `ComplianceNFT` | `Transfer`, `OperatorSet` | `KycHolder` (the KYC set), `ComplianceOperator` |
| `OutletRouter` (+ `OutletRouterLegacy`, the pre-v4 deployment) | `QueueSet`, `V4VenueSet`, `StrategyRegistered/Delisted`, `GuardSet`, `InstantExit`, `Purchase`, `PatientEnqueued` | `RouterListing`, `RouterSwap` (with `venue: AQUA \| V4` — for v4 fills `orderHash` is the PoolId, so `strategy` is null and `v4Pool` is set), `PatientEnqueue`, `TwapGuard`; `Asset.queue` = the router's canonical queue |
| `V4Venue` | `PoolRegistered`, `V4Swapped` | `V4Pool` config (`fee`, `tickSpacing`, `hooks`) + `Asset.v4Pool` link, `V4Swap` per venue fill, USDC volume rollup on the pool |
| `RedemptionQueue` ×2 | `RedeemRequest`, `Submitted`, `Settled`, `Withdraw`, `OperatorSet`, `FeesClaimed`, `RolesSet` | `Queue`, `QueueEpoch`, `QueueRequest` (FIFO-attributed claims), `QueueClaim` |
| `CuratorVault` ×2 | `Deposit`, `RedeemRequest`, `Withdraw`, `EpochFulfilled`, `MandateAssetAdded`, `PoolCreated/Docked`, `Recycled`, `QueueClaimed`, `RolesSet`, `Transfer` | `Vault`, `VaultEpoch`, `VaultRedeemRequest`, `VaultDeposit`, `VaultPosition`, `MandateAsset`, `RecycleAction`, `VaultQueueClaim` |
| `RWAGateHook` | `ObservationRecorded` (new + legacy signature) | `V4Pool`, `Observation` — secondary-market price series |
| `TestUSDC`, `rwaTBILL`, `rwaCREDIT` | `Transfer`, `GatedSet` | `TokenBalance` per holder (vault idle cash, queue escrow, maker wallets), `Asset.gated` |
| `Faucet` | `Dripped` | `FaucetDrip` — onboarding funnel |

Plus rollups: `Protocol` (singleton counters), `ProtocolDayData`, `AssetDayData`
(volumes, mean `rateVsNavBps`, NAV OHLC-ish fields).

Pool parameters (spread, decay start/floor, band, staleness) are decoded from
`CuratorVault.PoolCreated` into `Strategy`, so the agent sees each pool's configuration —
not just its flow.

## Build & deploy

```bash
npm install
npm run sync      # regenerate abis/ + addresses from ../../rwa-outlet-contracts-core (graph-contracts-sync)
npm run build     # graph codegen + graph build --network sepolia

graph auth $GRAPH_DEPLOY_KEY
npm run deploy    # deploys studio slug "rwa-outlet-contracts-core" (pass --version-label vX.Y.Z)
```

### After a contract redeploy

1. `forge build` in `rwa-outlet-contracts-core` (refreshes `out/` and `deployments/`).
2. `START_BLOCK=<redeploy block> npm run sync` — rewrites `networks.json` addresses +
   start blocks and `src/addresses.ts`.
3. `npm run build && npm run deploy`.

The `RWAGateHook` ABI intentionally carries **two** `ObservationRecorded` signatures: the
current hook emits `(poolId, sqrtPriceX96, rate1e18, cumulativeX128)`; hooks deployed before
the `rate1e18` field emit the 3-arg version, for which the mapping derives the rate from
`sqrtPriceX96` once `GuardSet` has linked the v4 pool to its asset.

Adding a new RWA later means one new `RedemptionQueue` (and token) data source in
`subgraph.yaml` + `networks.json` — copy an existing block, the mappings are instance-agnostic.

## Agent query cookbook

Patient-pool clearing level (e.g. "auction clears > 250 bps below NAV for 6h → act"):

```graphql
{
  trades(
    where: { poolId: 2, isExit: true, timestamp_gt: $sixHoursAgo }
    orderBy: timestamp
    orderDirection: desc
  ) {
    rateVsNavBps
    amountOut
    strategy { floorBps startBps auctionDuration }
    timestamp
  }
}
```

Queue backlog aging + settlement triggers (start from `assets.queue` — that's the
router's *current* queue; `queues` also lists superseded instances):

```graphql
{
  assets(where: { kind: RWA }) { symbol queue { id pendingShares claimableShares currentEpoch lastSettledNav } }
  queueEpoches(where: { status_not: SETTLED }) {  # graph-node pluralizes Epoch as "Epoches"
    queue { id }
    epochNumber
    status
    totalShares
    firstRequestAt
    submittedAt
  }
}
```

Pool inventory & utilization (ship more / dock):

```graphql
{
  strategies(where: { active: true }) {
    id
    kind
    asset { symbol }
    vault { symbol }
    spreadBps
    balances { token balance }
    exitVolumeUsdc
    lastTradeAt
    lastTradeRateVsNavBps
  }
}
```

NAV staleness alerting:

```graphql
{
  assets(where: { kind: RWA }) { symbol nav navUpdatedAt }
}
```

Vault health (LP flows, free vs reserved cash, recycling in flight):

```graphql
{
  vaults {
    symbol
    totalShares
    idleUsdc
    reservedAssets
    pendingShares
    lastSharePrice
    mandateAssets { asset { symbol } perAssetCap queuedShares }
  }
}
```

Secondary-lane sanity (program quote vs v4 TWAP context, venue flow):

```graphql
{
  v4Pools {
    id
    asset { symbol }
    fee
    lastRate1e18
    lastObservationAt
    observationCount
    swapCount
    volumeUsdc
  }
  routerSwaps(where: { venue: V4 }) { kind amountIn amountOut timestamp }
}
```

The router redeployed at block 11349348 when the v4 lane shipped (state carried over by
`MigrateRouterState.s.sol`); `OutletRouterLegacy` keeps the pre-migration swap history
indexed. Listings re-registered during the migration keep one `RouterListing` entity —
`registeredAt` reflects the re-registration.
