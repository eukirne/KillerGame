const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getUserBalances, fromCents, BASE_CURRENCY } = require('../utils/balances');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const balances = await getUserBalances(req.userId);
    const totalOwedToYou = balances.filter((b) => b.netCents > 0).reduce((s, b) => s + b.netCents, 0);
    const totalYouOwe = balances.filter((b) => b.netCents < 0).reduce((s, b) => s - b.netCents, 0);

    res.json({
      totalOwedToYou: fromCents(totalOwedToYou),
      totalYouOwe: fromCents(totalYouOwe),
      netBalance: fromCents(totalOwedToYou - totalYouOwe),
      currency: BASE_CURRENCY,
    });
  })
);

module.exports = router;
