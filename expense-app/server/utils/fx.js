const db = require('../db/db');

// Every rate is cached relative to USD (regardless of what the caller's
// actual target currency is) and any-to-any conversion is derived by
// dividing two USD-relative rates. This keeps the fx_rates cache small
// (one row per currency/date, not one per currency/date/target) and means
// a new target currency never needs a schema change.
const DEFAULT_CURRENCY = 'USD';

async function cacheGet(currency, date) {
  const row = await db.get('SELECT rate FROM fx_rates WHERE currency = ? AND date = ?', [currency, date]);
  return row ? row.rate : null;
}

// Most recent rate we have for this currency on any date, used as a
// last-resort fallback when today's lookup for a specific date fails.
async function cacheGetClosest(currency) {
  const row = await db.get('SELECT rate FROM fx_rates WHERE currency = ? ORDER BY date DESC LIMIT 1', [currency]);
  return row ? row.rate : null;
}

async function cacheSet(currency, date, rate) {
  await db.run(
    `INSERT INTO fx_rates (currency, date, rate) VALUES (?, ?, ?)
     ON CONFLICT (currency, date) DO UPDATE SET rate = EXCLUDED.rate, fetched_at = NOW()`,
    [currency, date, rate]
  );
}

// Frankfurter (ECB-backed, free, no API key) gives how many USD equal 1
// unit of `currency`, for a given historical date.
async function fetchUsdRate(currency, date) {
  const url = `https://api.frankfurter.dev/v1/${date}?base=${encodeURIComponent(currency)}&symbols=${DEFAULT_CURRENCY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Exchange rate lookup failed (${res.status})`);
  const data = await res.json();
  const rate = data && data.rates && data.rates[DEFAULT_CURRENCY];
  if (typeof rate !== 'number') throw new Error(`No exchange rate available for ${currency} on ${date}`);
  return rate;
}

/**
 * Resolve USD rates for a batch of { currency, date } pairs, hitting the
 * network only for cache misses (and only once per unique pair). Returns
 * Map<"CURRENCY|date", rateToUsd>. A pair whose lookup fails falls back to
 * the most recent cached rate for that currency, or 1 as a last resort, so
 * a flaky rate provider degrades balances rather than breaking them.
 */
async function getUsdRates(pairs) {
  const map = new Map();
  const misses = [];
  const seen = new Set();

  for (const { currency, date } of pairs) {
    const key = `${currency}|${date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (currency === DEFAULT_CURRENCY) {
      map.set(key, 1);
      continue;
    }
    const cached = await cacheGet(currency, date);
    if (cached != null) map.set(key, cached);
    else misses.push({ currency, date, key });
  }

  await Promise.all(
    misses.map(async ({ currency, date, key }) => {
      try {
        const rate = await fetchUsdRate(currency, date);
        await cacheSet(currency, date, rate);
        map.set(key, rate);
      } catch (e) {
        const fallback = await cacheGetClosest(currency);
        map.set(key, fallback != null ? fallback : 1);
      }
    })
  );

  return map;
}

/**
 * Resolve `targetCurrency` rates for a batch of { currency, date } pairs —
 * i.e. how many units of targetCurrency equal 1 unit of `currency`, on
 * `date`. Returns Map<"CURRENCY|date", rate>.
 */
async function getRates(pairs, targetCurrency = DEFAULT_CURRENCY) {
  const target = targetCurrency || DEFAULT_CURRENCY;
  const uniqueDates = [...new Set(pairs.map((p) => p.date))];
  const targetPairs = target === DEFAULT_CURRENCY ? [] : uniqueDates.map((date) => ({ currency: target, date }));

  const usdRates = await getUsdRates([...pairs, ...targetPairs]);

  const map = new Map();
  for (const { currency, date } of pairs) {
    const key = `${currency}|${date}`;
    if (map.has(key)) continue;
    const currencyToUsd = usdRates.get(`${currency}|${date}`) ?? 1;
    const targetToUsd = target === DEFAULT_CURRENCY ? 1 : usdRates.get(`${target}|${date}`) ?? 1;
    map.set(key, targetToUsd ? currencyToUsd / targetToUsd : currencyToUsd);
  }
  return map;
}

module.exports = { getRates, DEFAULT_CURRENCY };
