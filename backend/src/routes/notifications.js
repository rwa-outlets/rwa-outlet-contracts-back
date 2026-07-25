const express = require('express');
const Notification = require('../models/Notification');
const router = express.Router();

router.get('/notifications', async (req, res, next) => {
  try {
    const { user } = req.query;
    if (!user) return res.status(400).json({ error: 'user query param is required' });
    const notifications = await Notification.find({ user }).sort({ createdAt: -1 }).limit(50);
    res.json(notifications);
  } catch (err) { next(err); }
});

router.post('/notifications/:id/read', async (req, res, next) => {
  try {
    const notification = await Notification.findByIdAndUpdate(req.params.id, { read: true }, { new: true });
    if (!notification) return res.status(404).json({ error: 'notification not found' });
    res.json(notification);
  } catch (err) { next(err); }
});

module.exports = router;
