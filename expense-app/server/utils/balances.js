const db = require('../db/db');
const { toCents, fromCents } = require('./money');
const fx = require('./fx');

function addDebt(map, ower, owee, cents) {
  if (!cents) return;
  const key = `${ower}:${owee}`;
  map.set(key, (map.get(key) || 0) + cents);
}

// Net amount `a` owes `b` (can be negative, meaning b owes a).
function getNet(map, a, b) {
  const forward = map.get(`${a}:${b}`) || 0;
  const backward = map.get(`${b}:${a}`) || 0;
  return forward - backward;
}

// Base-currency-equivalent cents for an amount that was in `currency` on `date`.
function baseCents(amount, currency, date, rates) {
  const rate = rates.get(`${currency}|${date}`) ?? 1;
  return toCents(amount * rate);
}

/**
 * Pairwise balances for a single user across every expense/settlement they're
 * directly part of (their whole "friends" ledger, spanning all groups plus
 * any direct non-group expenses). Amounts are converted to fx.BASE_CURRENCY
 * using the historical rate on each expense/settlement's own date, so mixed
 * currencies combine into one meaningful number instead of adding 1:1.
 * Returns [{ userId, netCents }] where netCents > 0 means the other user owes
 * the given user, and netCents < 0 means the given user owes them.
 */
async function getUserBalances(userId) {
  const shareRows = await db.all(
    `SELECT es.user_id AS ower, e.paid_by AS payer, es.amount AS amt, e.currency AS currency, e.date AS date
       FROM expense_shares es
       JOIN expenses e ON e.id = es.expense_id
       WHERE e.deleted = 0 AND es.user_id != e.paid_by
         AND (es.user_id = ? OR e.paid_by = ?)`,
    [userId, userId]
  );

  const settlementRows = await db.all(
    `SELECT from_user, to_user, amount, currency, date FROM settlements WHERE from_user = ? OR to_user = ?`,
    [userId, userId]
  );

  const rates = await fx.getRates([
    ...shareRows.map((r) => ({ currency: r.currency, date: r.date })),
    ...settlementRows.map((r) => ({ currency: r.currency, date: r.date })),
  ]);

  const map = new Map();
  const counterparts = new Set();

  for (const row of shareRows) {
    addDebt(map, row.ower, row.payer, baseCents(row.amt, row.currency, row.date, rates));
    counterparts.add(row.ower === userId ? row.payer : row.ower);
  }
  for (const row of settlementRows) {
    // from_user paid to_user, which cancels out from_user's debt to to_user.
    addDebt(map, row.to_user, row.from_user, baseCents(row.amount, row.currency, row.date, rates));
    counterparts.add(row.from_user === userId ? row.to_user : row.from_user);
  }

  const results = [];
  for (const c of counterparts) {
    const theyOweMe = -getNet(map, userId, c);
    if (theyOweMe !== 0) results.push({ userId: c, netCents: theyOweMe });
  }
  return results;
}

async function getUserOverallNet(userId) {
  const balances = await getUserBalances(userId);
  return balances.reduce((sum, b) => sum + b.netCents, 0);
}

/**
 * Net position of every member within a single group, in fx.BASE_CURRENCY
 * cents: positive means the group owes them money overall, negative means
 * they owe the group. Returns Map<userId, cents>.
 */
async function getGroupNetPositions(groupId, memberIds) {
  const net = new Map(memberIds.map((id) => [id, 0]));

  const expenseRows = await db.all(`SELECT id, amount, paid_by, currency, date FROM expenses WHERE group_id = ? AND deleted = 0`, [
    groupId,
  ]);
  const expenseIds = expenseRows.map((e) => e.id);
  const expenseById = new Map(expenseRows.map((e) => [e.id, e]));

  let shareRows = [];
  if (expenseIds.length) {
    const placeholders = expenseIds.map(() => '?').join(',');
    shareRows = await db.all(`SELECT expense_id, user_id, amount FROM expense_shares WHERE expense_id IN (${placeholders})`, expenseIds);
  }

  const settlementRows = await db.all(`SELECT from_user, to_user, amount, currency, date FROM settlements WHERE group_id = ?`, [groupId]);

  const rates = await fx.getRates([
    ...expenseRows.map((e) => ({ currency: e.currency, date: e.date })),
    ...settlementRows.map((s) => ({ currency: s.currency, date: s.date })),
  ]);

  for (const e of expenseRows) {
    net.set(e.paid_by, (net.get(e.paid_by) || 0) + baseCents(e.amount, e.currency, e.date, rates));
  }
  for (const s of shareRows) {
    const e = expenseById.get(s.expense_id);
    net.set(s.user_id, (net.get(s.user_id) || 0) - baseCents(s.amount, e.currency, e.date, rates));
  }
  for (const s of settlementRows) {
    const cents = baseCents(s.amount, s.currency, s.date, rates);
    net.set(s.from_user, (net.get(s.from_user) || 0) + cents);
    net.set(s.to_user, (net.get(s.to_user) || 0) - cents);
  }

  return net;
}

/**
 * Pairwise "who owes whom" within a single group (not simplified) — used for
 * the group's balance breakdown list. Amounts in fx.BASE_CURRENCY cents.
 */
async function getGroupPairwiseBalances(groupId, memberIds) {
  const expenseRows = await db.all(`SELECT id, paid_by, currency, date FROM expenses WHERE group_id = ? AND deleted = 0`, [groupId]);
  const expenseIds = expenseRows.map((e) => e.id);
  const expenseById = new Map(expenseRows.map((e) => [e.id, e]));

  let shareRows = [];
  if (expenseIds.length) {
    const placeholders = expenseIds.map(() => '?').join(',');
    shareRows = await db.all(`SELECT expense_id, user_id, amount FROM expense_shares WHERE expense_id IN (${placeholders})`, expenseIds);
  }

  const settlementRows = await db.all(`SELECT from_user, to_user, amount, currency, date FROM settlements WHERE group_id = ?`, [groupId]);

  const rates = await fx.getRates([
    ...expenseRows.map((e) => ({ currency: e.currency, date: e.date })),
    ...settlementRows.map((s) => ({ currency: s.currency, date: s.date })),
  ]);

  const map = new Map();
  for (const s of shareRows) {
    const e = expenseById.get(s.expense_id);
    if (e.paid_by !== s.user_id) {
      addDebt(map, s.user_id, e.paid_by, baseCents(s.amount, e.currency, e.date, rates));
    }
  }
  for (const s of settlementRows) {
    addDebt(map, s.to_user, s.from_user, baseCents(s.amount, s.currency, s.date, rates));
  }

  const pairs = [];
  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      const a = memberIds[i];
      const b = memberIds[j];
      const net = getNet(map, a, b); // a owes b
      if (net !== 0) {
        pairs.push(net > 0 ? { from: a, to: b, amountCents: net } : { from: b, to: a, amountCents: -net });
      }
    }
  }
  return pairs;
}

/**
 * Greedy minimal-transaction debt simplification, same idea Splitwise uses:
 * repeatedly match the biggest creditor with the biggest debtor.
 */
function simplifyDebts(netPositions) {
  const creditors = [];
  const debtors = [];
  for (const [userId, cents] of netPositions.entries()) {
    if (cents > 0) creditors.push({ userId, cents });
    else if (cents < 0) debtors.push({ userId, cents: -cents });
  }
  creditors.sort((a, b) => b.cents - a.cents);
  debtors.sort((a, b) => b.cents - a.cents);

  const transactions = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amount = Math.min(d.cents, c.cents);
    if (amount > 0) {
      transactions.push({ from: d.userId, to: c.userId, amountCents: amount });
      d.cents -= amount;
      c.cents -= amount;
    }
    if (d.cents === 0) i++;
    if (c.cents === 0) j++;
  }
  return transactions;
}

module.exports = {
  getUserBalances,
  getUserOverallNet,
  getGroupNetPositions,
  getGroupPairwiseBalances,
  simplifyDebts,
  fromCents,
  toCents,
  BASE_CURRENCY: fx.BASE_CURRENCY,
};
