import pg from 'pg';

// numeric -> number, int8 -> number, date -> 'YYYY-MM-DD' string (avoid timezone shifts)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number.parseFloat(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));
pg.types.setTypeParser(1082, (v) => v);

/**
 * A "db" is `{ query(text, params) => {rows}, tx(fn), end() }`.
 * `tx` gives `fn` an executor with the same `query` shape, all on one connection.
 * Tests provide the same shape backed by PGlite (see tests/helpers/pglite.js).
 */
export function createPgDb({ connectionString, ssl = true, max = 10 }) {
  const useSsl = ssl && !/localhost|127\.0\.0\.1/.test(connectionString) ? { rejectUnauthorized: false } : false;
  const pool = new pg.Pool({ connectionString, max, ssl: useSsl, idleTimeoutMillis: 30_000 });
  pool.on('error', () => {
    /* idle client errors are surfaced on the next query; avoid crashing the process */
  });

  return {
    query: (text, params) => pool.query(text, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (t, p) => client.query(t, p) });
        await client.query('commit');
        return result;
      } catch (err) {
        try {
          await client.query('rollback');
        } catch {
          /* connection already broken */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}
