const express = require('express');
const Trade = require('../models/Trade');
const { pools, assets } = require('../data/reference');
const router = express.Router();

router.get('/trades', async (req, res, next) => {
  try {
    const { poolId, limit = 50 } = req.query;
    const query = poolId ? { poolId } : {};
    const trades = await Trade.find(query).sort({ createdAt: -1 }).limit(Number(limit));
    res.json(trades);
  } catch (err) { next(err); }
});

// Simulates swap execution against a pool (no real chain settlement yet —
// see frontend README "Known Limitations"). Persists so the UI has real history to render.
router.post('/trades', async (req, res, next) => {
  try {
    const { poolId, direction, amount, maker } = req.body;
    const pool = pools.find((p) => p.id === poolId);
    if (!pool) return res.status(404).json({ error: 'pool not found' });
    if (!['exit', 'entry'].includes(direction)) return res.status(400).json({ error: 'direction must be exit or entry' });
    if (!(amount > 0)) return res.status(400).json({ error: 'amount must be > 0' });

    const asset = assets[pool.assetId];
    const spreadBps = pool.spread ?? pool.spreadInitial ?? pool.fee ?? 0;
    const effectiveRate = asset.currentNAV * (1 - spreadBps / 10000);
    const usdcReceived = Number((amount * effectiveRate).toFixed(2));

    const trade = await Trade.create({
      poolId, assetId: pool.assetId, direction, amount, rate: asset.currentNAV,
      usdcReceived, maker: maker || null, status: 'settled',
    });
    res.status(201).json(trade);
  } catch (err) { next(err); }
});

module.exports = router;
