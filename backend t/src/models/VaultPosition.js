const mongoose = require('mongoose');

const historyEntrySchema = new mongoose.Schema({
  type: { type: String, enum: ['deposit', 'withdraw', 'yield'], required: true },
  amount: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now },
  txHash: { type: String, default: null },
}, { _id: false });

const vaultPositionSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  vaultId: { type: String, required: true },
  shares: { type: Number, required: true, default: 0 },
  depositAmount: { type: Number, required: true, default: 0 },
  apy: { type: Number, default: 0 },
  pendingWithdrawal: {
    type: new mongoose.Schema({
      amountShares: Number,
      amountUSDC: Number,
      requestedAt: Date,
      status: { type: String, enum: ['pending', 'processing', 'completed'] },
    }, { _id: false }),
    default: null,
  },
  history: { type: [historyEntrySchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('VaultPosition', vaultPositionSchema);
