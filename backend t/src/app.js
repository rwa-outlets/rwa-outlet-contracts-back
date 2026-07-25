const express = require('express');
const cors = require('cors');
const env = require('./env');

const app = express();

app.use(cors({ origin: env.FRONTEND_URL }));
app.use(express.json());

// GET /health has no /api prefix — the k8s probe and the DO App Platform
// health check both hit it directly.
app.use(require('./routes/health'));

// Everything else is namespaced under /api/* (ingress forwards the prefix as-is).
const api = express.Router();
api.use(require('./routes/assets'));
api.use(require('./routes/pools'));
api.use(require('./routes/trades'));
api.use(require('./routes/queue'));
api.use(require('./routes/vaults'));
api.use(require('./routes/dashboard'));
api.use(require('./routes/notifications'));
app.use('/api', api);

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

module.exports = app;
