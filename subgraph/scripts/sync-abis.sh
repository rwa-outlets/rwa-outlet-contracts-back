#!/usr/bin/env bash
# graph-contracts-sync: regenerate subgraph/abis from the contract repos' forge artifacts.
# Run `forge build` in rwa-outlet-contracts-core first, then this script, and commit the
# result together with the contract change (docs/02-engine-spec.md §7).
#
#   CORE_REPO=…   path to rwa-outlet-contracts-core   (default ../../rwa-outlet-contracts-core)
#   FAUCET_REPO=… path to the faucet repo             (default ../../faucet)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="${CORE_REPO:-$HERE/../../../rwa-outlet-contracts-core}"
FAUCET="${FAUCET_REPO:-$HERE/../../../faucet}"
OUT="$HERE/../abis"
mkdir -p "$OUT"

extract() { # <artifact.json> <AbiName>
  jq '.abi' "$1" > "$OUT/$2.json"
  echo "  abis/$2.json  <-  $1"
}

extract "$CORE/out/Aqua.sol/Aqua.json"                         Aqua
extract "$CORE/out/AquaSwapVMRouter.sol/AquaSwapVMRouter.json" AquaSwapVMRouter
extract "$CORE/out/NavOracle.sol/NavOracle.json"               NavOracle
extract "$CORE/out/NavExtruction.sol/NavExtruction.json"       NavExtruction
extract "$CORE/out/ComplianceNFT.sol/ComplianceNFT.json"       ComplianceNFT
extract "$CORE/out/OutletRouter.sol/OutletRouter.json"         OutletRouter
extract "$CORE/out/CuratorVault.sol/CuratorVault.json"         CuratorVault
extract "$CORE/out/RedemptionQueue.sol/RedemptionQueue.json"   RedemptionQueue
extract "$CORE/out/RWAGateHook.sol/RWAGateHook.json"           RWAGateHook
extract "$CORE/out/RWAToken.sol/RWAToken.json"                 RWAToken
extract "$CORE/out/TestUSDC.sol/TestUSDC.json"                 TestUSDC
extract "$FAUCET/out/Faucet.sol/Faucet.json"                   Faucet

# The hook deployed before rate1e18 was added emits a 3-arg ObservationRecorded; keep the
# legacy signature in the ABI so the subgraph indexes both deployments (handlers pick the
# event by full signature).
jq '. += [{
  "anonymous": false,
  "inputs": [
    {"indexed": true,  "internalType": "PoolId",  "name": "poolId",         "type": "bytes32"},
    {"indexed": false, "internalType": "uint160", "name": "sqrtPriceX96",   "type": "uint160"},
    {"indexed": false, "internalType": "uint256", "name": "cumulativeX128", "type": "uint256"}
  ],
  "name": "ObservationRecorded",
  "type": "event"
}]' "$OUT/RWAGateHook.json" > "$OUT/RWAGateHook.json.tmp" && mv "$OUT/RWAGateHook.json.tmp" "$OUT/RWAGateHook.json"
echo "  abis/RWAGateHook.json  += legacy ObservationRecorded(bytes32,uint160,uint256)"

echo "done."
