const QueueRequest = require('../models/QueueRequest');
const Trade = require('../models/Trade');
const { assets } = require('../data/reference');

// Only seeds if the collections are empty, so it's safe to call on every boot.
async function seedIfEmpty() {
  const [queueCount, tradeCount] = await Promise.all([
    QueueRequest.countDocuments(),
    Trade.countDocuments(),
  ]);

  if (queueCount === 0) {
    await QueueRequest.create([
      {
        user: '0xUser1111111111111111111111111111111111',
        assetId: 'rwaTBILL', amountTokens: 10000, amountUSDC: 10012,
        expectedNAV: assets.rwaTBILL.currentNAV, epoch: 1, status: 'Pending',
        expectedSettlement: new Date(Date.now() + 7 * 86400000),
      },
      {
        user: '0xUser2222222222222222222222222222222222',
        assetId: 'rwaTBILL', amountTokens: 8000, amountUSDC: 8009.6,
        expectedNAV: assets.rwaTBILL.currentNAV, epoch: 0, status: 'Claimable',
        expectedSettlement: new Date(),
      },
    ]);
    console.log('[seed] queue requests seeded');
  }

  if (tradeCount === 0) {
    await Trade.create([
      { poolId: 'express-tbill', assetId: 'rwaTBILL', direction: 'exit', amount: 25000, rate: 1.0012, usdcReceived: 24987.52, status: 'settled' },
      { poolId: 'market-all', assetId: 'rwaCREDIT', direction: 'exit', amount: 15000, rate: 1.0432, usdcReceived: 15589.09, status: 'settled' },
    ]);
    console.log('[seed] trades seeded');
  }
}

module.exports = { seedIfEmpty };
