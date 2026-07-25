const express = require('express');
const { pools, poolTypes, assets } = require('../data/reference');
const router = express.Router();

function withAsset(pool) {
  return { ...pool, asset: assets[pool.assetId] || null };
}

router.get('/pool-types', (req, res) => {
  res.json(poolTypes);
});

router.get('/pools', (req, res) => {
  const { type } = req.query;
  const list = pools.filter((p) => !type || type === 'all' || p.type === type);
  res.json(list.map(withAsset));
});

router.get('/pools/:id', (req, res) => {
  const pool = pools.find((p) => p.id === req.params.id);
  if (!pool) return res.status(404).json({ error: 'pool not found' });
  res.json(withAsset(pool));
});

module.exports = router;
