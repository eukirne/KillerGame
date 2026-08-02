const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserBalances, fromCents } = require('../utils/balances');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const balances = getUserBalances(req.userId);
  const totalOwedToYou = balances.filter((b) => b.netCents > 0).reduce((s, b) => s + b.netCents, 0);
  const totalYouOwe = balances.filter((b) => b.netCents < 0).reduce((s, b) => s - b.netCents, 0);

  res.json({
    totalOwedToYou: fromCents(totalOwedToYou),
    totalYouOwe: fromCents(totalYouOwe),
    netBalance: fromCents(totalOwedToYou - totalYouOwe),
  });
});

module.exports = router;
