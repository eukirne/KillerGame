// All money math is done in integer cents to avoid floating point drift,
// then converted back to a 2-decimal number at the boundary.

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

function fromCents(cents) {
  return Math.round(cents) / 100;
}

// Split `totalCents` equally among `n` participants, distributing the
// leftover 1-cent remainders to the first participants (Splitwise does the same).
function splitEqualCents(totalCents, n) {
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  const shares = new Array(n).fill(base);
  for (let i = 0; i < remainder; i++) shares[i] += 1;
  return shares;
}

// Distribute `totalCents` proportionally to `weights` (any positive numbers),
// using the largest-remainder method so the parts sum exactly to totalCents.
function distributeProportional(totalCents, weights) {
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights <= 0) throw new Error('Weights must sum to a positive number');
  const raw = weights.map((w) => (totalCents * w) / sumWeights);
  const floors = raw.map(Math.floor);
  const allocated = floors.reduce((a, b) => a + b, 0);
  const remainder = totalCents - allocated;
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const result = floors.slice();
  for (let k = 0; k < remainder; k++) result[order[k % order.length].i] += 1;
  return result;
}

module.exports = { toCents, fromCents, splitEqualCents, distributeProportional };
