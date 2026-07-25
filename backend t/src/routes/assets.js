const express = require('express');
const { assets } = require('../data/reference');
const router = express.Router();

router.get('/assets', (req, res) => {
  res.json(Object.values(assets));
});

router.get('/assets/:id', (req, res) => {
  const asset = assets[req.params.id];
  if (!asset) return res.status(404).json({ error: 'asset not found' });
  res.json(asset);
});

module.exports = router;
