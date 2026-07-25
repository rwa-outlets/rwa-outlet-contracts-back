const express = require('express');
const QueueRequest = require('../models/QueueRequest');
const { assets } = require('../data/reference');
const router = express.Router();

const QUEUE_FEE_BPS = 5; // 5 bps, matches RedemptionQueue.queueFeeBps in the contracts

router.get('/queue', async (req, res, next) => {
  try {
    const { user, status } = req.query;
    const query = {};
    if (user) query.user = user;
    if (status) query.status = status;
    const requests = await QueueRequest.find(query).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) { next(err); }
});

// Create a redemption request — mirrors RedemptionQueue.requestRedeem (ERC-7540).
// Real contract call comes later; for now this books the request so the queue
// page has live state to show and settle against.
router.post('/queue', async (req, res, next) => {
  try {
    const { user, assetId, amountTokens } = req.body;
    const asset = assets[assetId];
    if (!user || !asset) return res.status(400).json({ error: 'user and a valid assetId are required' });
    if (!(amountTokens > 0)) return res.status(400).json({ error: 'amountTokens must be > 0' });

    const amountUSDC = Number((amountTokens * asset.currentNAV).toFixed(2));
    const expectedSettlement = new Date(Date.now() + (asset.settlementDays || 7) * 86400000);

    const request = await QueueRequest.create({
      user, assetId, amountTokens, amountUSDC,
      expectedNAV: asset.currentNAV,
      epoch: currentEpoch(),
      status: 'Pending',
      queueFee: QUEUE_FEE_BPS / 10000,
      expectedSettlement,
    });
    res.status(201).json(request);
  } catch (err) { next(err); }
});

// Claim a Claimable request — mirrors RedemptionQueue.redeem() once an epoch has settled.
router.post('/queue/:id/claim', async (req, res, next) => {
  try {
    const request = await QueueRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'request not found' });
    if (request.status !== 'Claimable') {
      return res.status(409).json({ error: `request is not claimable (status: ${request.status})` });
    }
    request.status = 'Claimed';
    request.claimedAt = new Date();
    request.usdcReceived = Number((request.amountUSDC * (1 - request.queueFee)).toFixed(2));
    await request.save();
    res.json(request);
  } catch (err) { next(err); }
});

// Demo-only helper: an issuer/curator would normally settle a whole epoch at once.
router.post('/queue/:id/mark-claimable', async (req, res, next) => {
  try {
    const request = await QueueRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'Claimable' },
      { new: true },
    );
    if (!request) return res.status(404).json({ error: 'request not found' });
    res.json(request);
  } catch (err) { next(err); }
});

function currentEpoch() {
  // One epoch per day for the demo; the real value comes from RedemptionQueue.currentEpoch.
  return Math.floor(Date.now() / 86400000);
}

module.exports = router;
