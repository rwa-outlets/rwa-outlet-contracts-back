// Static reference config for the demo — asset/pool/vault definitions.
// This mirrors the shapes the frontend already expects (see frontend/src/data/mockData.js).
// Once the subgraph is live, pools/assets should be read from indexed contract state instead.

const assets = {
  USDC: {
    id: 'USDC', name: 'USD Coin', symbol: 'USDC', decimals: 6,
    type: 'stablecoin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  rwaTBILL: {
    id: 'rwaTBILL', name: 'Tokenized T-Bill Fund', symbol: 'rwaTBILL', decimals: 18,
    type: 'rwa', category: 'T-Bill', settlement: 'T+7', currentNAV: 1.0012,
    issuanceAPY: 0.0525, address: '0x1234567890123456789012345678901234567890',
    issuer: 'Franklin Templeton', riskTier: 'express', settlementDays: 7,
  },
  rwaCREDIT: {
    id: 'rwaCREDIT', name: 'Private Credit Fund', symbol: 'rwaCREDIT', decimals: 18,
    type: 'rwa', category: 'Private Credit', settlement: 'T+90', currentNAV: 1.0432,
    issuanceAPY: 0.085, address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    issuer: 'Goldman Sachs', riskTier: 'patient', settlementDays: 90,
  },
  rwaREAL: {
    id: 'rwaREAL', name: 'Real Estate Token', symbol: 'rwaREAL', decimals: 18,
    type: 'rwa', category: 'Real Estate', settlement: 'T+30', currentNAV: 1.0250,
    issuanceAPY: 0.065, address: '0x9876543210987654321098765432109876543210',
    issuer: 'RealT', riskTier: 'patient', settlementDays: 30,
  },
  RWAT: {
    id: 'RWAT', name: 'RWA Index Token', symbol: 'RWAT', decimals: 18,
    type: 'rwa', category: 'Index', settlement: 'T+14', currentNAV: 1.0185,
    issuanceAPY: 0.048, address: '0x5432109876543210987654321098765432109876',
    issuer: 'TokenSoft', riskTier: 'express', settlementDays: 14,
  },
};

const poolTypes = {
  express: {
    id: 'express', name: 'Express', icon: '⚡',
    description: 'High-liquidity RWAs with short settlement. Instant USDC at NAV minus a tight spread (5-25 bps).',
    typicalSpread: '5-25 bps', settlementTime: 'T+1 to T+7', riskLevel: 'Low',
  },
  patient: {
    id: 'patient', name: 'Patient', icon: '⏳',
    description: 'Longer-dated / less liquid RWAs. Instant USDC via Dutch-decay auction, tight to floor.',
    typicalSpread: '50-300 bps', settlementTime: 'T+14 to T+180', riskLevel: 'Medium',
  },
  market: {
    id: 'market', name: 'Market', icon: '💱',
    description: 'Two-sided constant-product AMM. Quotes both exits and entries.',
    typicalSpread: '30 bps fee', settlementTime: 'Instant', riskLevel: 'Medium',
  },
};

const pools = [
  { id: 'express-tbill', name: 'Express - T-Bill Pool', type: 'express', assetId: 'rwaTBILL', spread: 15, tvl: 420000, volume24h: 85000, utilization: 0.72, activeMakers: 12, capacity: 600000, isActive: true },
  { id: 'express-index', name: 'Express - RWA Index', type: 'express', assetId: 'RWAT', spread: 20, tvl: 315000, volume24h: 62000, utilization: 0.68, activeMakers: 8, capacity: 500000, isActive: true },
  { id: 'patient-credit', name: 'Patient - Private Credit', type: 'patient', assetId: 'rwaCREDIT', spreadInitial: 50, spreadFloor: 30, tvl: 380000, volume24h: 54000, utilization: 0.61, activeMakers: 6, capacity: 550000, isActive: true },
  { id: 'patient-real', name: 'Patient - Real Estate', type: 'patient', assetId: 'rwaREAL', spreadInitial: 80, spreadFloor: 40, tvl: 210000, volume24h: 38000, utilization: 0.55, activeMakers: 4, capacity: 400000, isActive: true },
  { id: 'market-all', name: 'Market - All RWAs', type: 'market', assetId: 'rwaCREDIT', fee: 30, tvl: 225000, volume24h: 162000, utilization: 0.80, activeMakers: 5, capacity: 300000, isActive: true },
];

const vaults = [
  { id: 'express-tier', name: 'Express Tier Vault', type: 'express', description: 'Vault for high-liquidity, short-settlement RWAs', totalAssets: 850000, apy: 0.058, poolIds: ['express-tbill', 'express-index'] },
  { id: 'patient-tier', name: 'Patient Tier Vault', type: 'patient', description: 'Vault for longer-dated, less liquid RWAs', totalAssets: 590000, apy: 0.082, poolIds: ['patient-credit', 'patient-real'] },
];

const curatorAgents = [
  { id: 'curator-express', vaultId: 'express-tier', name: 'Express Curator', status: 'active', lastAction: 'rebalance', lastActionAt: new Date().toISOString() },
  { id: 'curator-patient', vaultId: 'patient-tier', name: 'Patient Curator', status: 'active', lastAction: 'pool-create', lastActionAt: new Date().toISOString() },
];

module.exports = { assets, poolTypes, pools, vaults, curatorAgents };
