const express = require('express');
const QueueRequest = require('../models/QueueRequest');
const Trade = require('../models/Trade');
const { pools, curatorAgents } = require('../data/reference');
const router = express.Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const totalTVL = pools.reduce((sum, p) => sum + p.tvl, 0);
    const volume24h = pools.reduce((sum, p) => sum + p.volume24h, 0);
    const activePools = pools.filter((p) => p.isActive).length;
    const activeMakers = pools.reduce((sum, p) => sum + p.activeMakers, 0);

    const [pendingQueue, recentTrades] = await Promise.all([
      QueueRequest.find({ status: { $in: ['Pending', 'Submitted'] } }),
      Trade.find().sort({ createdAt: -1 }).limit(5),
    ]);
    const queueTVL = pendingQueue.reduce((sum, r) => sum + r.amountUSDC, 0);

    res.json({
      totalTVL,
      volume24h,
      activePools,
      totalPools: pools.length,
      activeMakers,
      totalQueueRequests: pendingQueue.length,
      queueTVL,
      yieldStreams: { spreads: 0.045, capitalReuse: 0.018, navCapture: 0.010 },
      recentActivity: recentTrades.map((t) => ({
        type: 'trade', pool: t.poolId, amount: t.amount, timestamp: t.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/yield-breakdown', (req, res) => {
  res.json([
    { source: 'Redemption Spreads', value: 0.045 },
    { source: 'Capital Reuse', value: 0.018 },
    { source: 'NAV Capture', value: 0.010 },
  ]);
});

router.get('/curator-agents', (req, res) => {
  res.json(curatorAgents);
});

module.exports = router;
