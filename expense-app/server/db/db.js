const path = require('path');
const fs = require('fs');
const { Pool, types } = require('pg');

// Keep DATE columns as plain 'YYYY-MM-DD' strings (not JS Date objects) so
// they round-trip exactly as they did with SQLite — used verbatim in FX
// lookups, <input type="date">, and API responses. OID 1082 = date.
types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required (a Postgres connection string, e.g. from Neon or Supabase).');
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
  connectionString,
  // Managed Postgres providers (Neon, Supabase, Render) require SSL; local
  // dev Postgres normally doesn't have it configured at all.
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Serverless providers like Neon suspend their compute after a few
  // minutes idle and proxy every new connection through a pooler with its
  // own handshake overhead, so a short idle timeout that keeps forcing
  // fresh connections is the worst case for them. Keep pool connections
  // (and the underlying TCP socket) alive longer between requests instead
  // of tearing them down and paying that cost again on the next click.
  keepAlive: true,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// better-sqlite3 used `?` placeholders; node-postgres uses `$1, $2, ...`.
// Translating here keeps every call site's SQL unchanged from the SQLite
// version. Safe because none of our queries contain a literal `?` outside
// of a placeholder position.
function toPgQuery(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function makeQueryMethods(queryable) {
  return {
    async get(sql, params = []) {
      const result = await queryable.query(toPgQuery(sql), params);
      return result.rows[0];
    },
    async all(sql, params = []) {
      const result = await queryable.query(toPgQuery(sql), params);
      return result.rows;
    },
    // Returns the raw pg result ({ rows, rowCount, ... }). For inserts whose
    // generated id is needed, add `RETURNING id` to the SQL and read
    // `result.rows[0].id`.
    async run(sql, params = []) {
      return queryable.query(toPgQuery(sql), params);
    },
  };
}

const db = {
  ...makeQueryMethods(pool),

  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = makeQueryMethods(client);
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async init() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await pool.query(schema);
  },
};

module.exports = db;
