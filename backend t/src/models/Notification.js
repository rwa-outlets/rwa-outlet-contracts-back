const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  type: { type: String, required: true }, // e.g. 'queue-claimable', 'trade-settled', 'yield-accrued'
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
