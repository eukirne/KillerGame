const { toCents, distributeProportional } = require('./money');

/**
 * Turns a split request into a list of { userId, amountCents }.
 * `participants` shape depends on splitType:
 *  - equal:   [userId, ...]
 *  - exact:   [{ userId, amount }, ...]   amounts must add up to totalAmount
 *  - percent: [{ userId, percent }, ...]  percents must add up to ~100
 *  - shares:  [{ userId, shares }, ...]   arbitrary positive weights
 */
function computeShares(splitType, totalAmount, participants) {
  const totalCents = toCents(totalAmount);
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error('At least one participant is required');
  }

  if (splitType === 'equal') {
    const userIds = participants.map((p) => (typeof p === 'object' ? p.userId : p));
    const weights = userIds.map(() => 1);
    const cents = distributeProportional(totalCents, weights);
    return userIds.map((userId, i) => ({ userId: Number(userId), amountCents: cents[i] }));
  }

  if (splitType === 'exact') {
    const rows = participants.map((p) => ({ userId: Number(p.userId), amountCents: toCents(p.amount) }));
    const sum = rows.reduce((a, r) => a + r.amountCents, 0);
    if (sum !== totalCents) {
      throw new Error('Exact amounts must add up to the total expense amount');
    }
    return rows;
  }

  if (splitType === 'percent') {
    const percents = participants.map((p) => Number(p.percent));
    const sumPercent = percents.reduce((a, b) => a + b, 0);
    if (Math.abs(sumPercent - 100) > 0.02) {
      throw new Error('Percentages must add up to 100');
    }
    const cents = distributeProportional(totalCents, percents);
    return participants.map((p, i) => ({ userId: Number(p.userId), amountCents: cents[i] }));
  }

  if (splitType === 'shares') {
    const weights = participants.map((p) => Number(p.shares));
    if (weights.some((w) => !(w > 0))) throw new Error('Shares must be positive numbers');
    const cents = distributeProportional(totalCents, weights);
    return participants.map((p, i) => ({ userId: Number(p.userId), amountCents: cents[i] }));
  }

  throw new Error(`Unknown split type: ${splitType}`);
}

module.exports = { computeShares };
