const express = require('express');
const router = express.Router();

// k8s liveness/readiness probes hit this — must stay fast and dependency-free.
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

module.exports = router;
