const mongoose = require('mongoose');

const queueRequestSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  assetId: { type: String, required: true },
  amountTokens: { type: Number, required: true },
  amountUSDC: { type: Number, required: true },
  expectedNAV: { type: Number, required: true },
  epoch: { type: Number, required: true },
  status: { type: String, enum: ['Pending', 'Submitted', 'Claimable', 'Claimed'], default: 'Pending' },
  queueFee: { type: Number, default: 0.0005 },
  expectedSettlement: { type: Date },
  submittedAt: { type: Date, default: Date.now },
  claimedAt: { type: Date, default: null },
  usdcReceived: { type: Number, default: null },
  txHash: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('QueueRequest', queueRequestSchema);
