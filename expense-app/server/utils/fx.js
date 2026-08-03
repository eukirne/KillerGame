const db = require('../db/db');

// All cross-currency balance math converts into this currency.
const BASE_CURRENCY = 'USD';

function cacheGet(currency, date) {
  const row = db.prepare('SELECT rate FROM fx_rates WHERE currency = ? AND date = ?').get(currency, date);
  return row ? row.rate : null;
}

// Most recent rate we have for this currency on any date, used as a
// last-resort fallback when today's lookup for a specific date fails.
function cacheGetClosest(currency) {
  const row = db.prepare('SELECT rate FROM fx_rates WHERE currency = ? ORDER BY date DESC LIMIT 1').get(currency);
  return row ? row.rate : null;
}

function cacheSet(currency, date, rate) {
  db.prepare('INSERT OR REPLACE INTO fx_rates (currency, date, rate) VALUES (?, ?, ?)').run(currency, date, rate);
}

// Frankfurter (ECB-backed, free, no API key) gives how many `to` units
// equal 1 unit of `from`, for a given historical date.
async function fetchRate(currency, date) {
  const url = `https://api.frankfurter.dev/v1/${date}?base=${encodeURIComponent(currency)}&symbols=${BASE_CURRENCY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Exchange rate lookup failed (${res.status})`);
  const data = await res.json();
  const rate = data && data.rates && data.rates[BASE_CURRENCY];
  if (typeof rate !== 'number') throw new Error(`No exchange rate available for ${currency} on ${date}`);
  return rate;
}

/**
 * Resolve BASE_CURRENCY rates for a batch of { currency, date } pairs,
 * hitting the network only for cache misses (and only once per unique pair).
 * Returns Map<"CURRENCY|date", rate>. A pair whose lookup fails falls back
 * to the most recent cached rate for that currency, or 1 as a last resort,
 * so a flaky rate provider degrades balances rather than breaking them.
 */
async function getRates(pairs) {
  const map = new Map();
  const misses = [];

  for (const { currency, date } of pairs) {
    const key = `${currency}|${date}`;
    if (map.has(key)) continue;
    if (currency === BASE_CURRENCY) {
      map.set(key, 1);
      continue;
    }
    const cached = cacheGet(currency, date);
    if (cached != null) map.set(key, cached);
    else misses.push({ currency, date, key });
  }

  await Promise.all(
    misses.map(async ({ currency, date, key }) => {
      try {
        const rate = await fetchRate(currency, date);
        cacheSet(currency, date, rate);
        map.set(key, rate);
      } catch (e) {
        const fallback = cacheGetClosest(currency);
        map.set(key, fallback != null ? fallback : 1);
      }
    })
  );

  return map;
}

module.exports = { getRates, BASE_CURRENCY };
