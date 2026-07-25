const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  poolId: { type: String, required: true, index: true },
  assetId: { type: String, required: true },
  direction: { type: String, enum: ['exit', 'entry'], required: true },
  amount: { type: Number, required: true },
  rate: { type: Number, required: true },
  usdcReceived: { type: Number, required: true },
  maker: { type: String, default: null },
  txHash: { type: String, default: null },
  status: { type: String, enum: ['pending', 'settled'], default: 'settled' },
}, { timestamps: true });

module.exports = mongoose.model('Trade', tradeSchema);
