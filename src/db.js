import pg from "pg";
export function database(url) {
  return new pg.Pool({
    connectionString: url,
    max: 12,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
}
export async function tx(pool, work) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await work(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export const one = async (db, sql, args = []) =>
  (await db.query(sql, args)).rows[0];
