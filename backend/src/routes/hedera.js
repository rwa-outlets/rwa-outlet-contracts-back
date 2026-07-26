// Hedera agentic-payments observability.
//
//   GET /api/hedera/status    — treasury account, balance, HCS topic, config
//   GET /api/hedera/receipts  — last 50 settlements (payments + HCS logs),
//                               each with a hashscan.io link. This is the
//                               live audit trail the demo & judges click.

const express = require('express');
const hedera = require('../services/hedera');

const router = express.Router();

router.get('/hedera/status', async (req, res) => {
  if (!hedera.isConfigured()) {
    return res.json({ configured: false });
  }
  try {
    return res.json(await hedera.getStatus());
  } catch (err) {
    return res.status(502).json({ configured: true, error: err.message });
  }
});

router.get('/hedera/receipts', (req, res) => {
  res.json({
    configured: hedera.isConfigured(),
    receipts: hedera.getReceipts(),
  });
});

module.exports = router;
