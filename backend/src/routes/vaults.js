const express = require('express');
const VaultPosition = require('../models/VaultPosition');
const { vaults } = require('../data/reference');
const router = express.Router();

router.get('/vaults', (req, res) => {
  res.json(vaults);
});

router.get('/vaults/:id', (req, res) => {
  const vault = vaults.find((v) => v.id === req.params.id);
  if (!vault) return res.status(404).json({ error: 'vault not found' });
  res.json(vault);
});

router.get('/vault-positions', async (req, res, next) => {
  try {
    const { user, vaultId } = req.query;
    const query = {};
    if (user) query.user = user;
    if (vaultId) query.vaultId = vaultId;
    const positions = await VaultPosition.find(query).sort({ createdAt: -1 });
    res.json(positions);
  } catch (err) { next(err); }
});

// Deposit USDC into a curator vault — mirrors CuratorVault.deposit(). 1 share == 1 USDC at open.
router.post('/vault-positions', async (req, res, next) => {
  try {
    const { user, vaultId, amount } = req.body;
    const vault = vaults.find((v) => v.id === vaultId);
    if (!user || !vault) return res.status(400).json({ error: 'user and a valid vaultId are required' });
    if (!(amount > 0)) return res.status(400).json({ error: 'amount must be > 0' });

    let position = await VaultPosition.findOne({ user, vaultId });
    if (!position) {
      position = new VaultPosition({ user, vaultId, apy: vault.apy });
    }
    position.shares += amount;
    position.depositAmount += amount;
    position.history.push({ type: 'deposit', amount });
    await position.save();
    res.status(201).json(position);
  } catch (err) { next(err); }
});

// Request a withdrawal — mirrors the vault's async redeem queue rather than an instant transfer.
router.post('/vault-positions/:id/withdraw', async (req, res, next) => {
  try {
    const { amountShares } = req.body;
    const position = await VaultPosition.findById(req.params.id);
    if (!position) return res.status(404).json({ error: 'position not found' });
    if (!(amountShares > 0) || amountShares > position.shares) {
      return res.status(400).json({ error: 'amountShares must be > 0 and <= current shares' });
    }
    position.pendingWithdrawal = {
      amountShares,
      amountUSDC: amountShares, // 1:1 for the demo; real value comes from vault share price
      requestedAt: new Date(),
      status: 'pending',
    };
    await position.save();
    res.json(position);
  } catch (err) { next(err); }
});

module.exports = router;
