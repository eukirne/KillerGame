const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserBalances, fromCents } = require('../utils/balances');
const { getUserById } = require('../utils/helpers');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = await getUserById(req.userId);
    const currency = me.default_currency;
    const balances = await getUserBalances(req.userId, currency);
    const totalOwedToYou = balances.filter((b) => b.netCents > 0).reduce((s, b) => s + b.netCents, 0);
    const totalYouOwe = balances.filter((b) => b.netCents < 0).reduce((s, b) => s - b.netCents, 0);

    res.json({
      totalOwedToYou: fromCents(totalOwedToYou),
      totalYouOwe: fromCents(totalYouOwe),
      netBalance: fromCents(totalOwedToYou - totalYouOwe),
      currency,
    });
  })
);

module.exports = router;
