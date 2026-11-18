import { readConfig } from "./config.js";
import { database, one } from "./db.js";
import { provider, reconcile } from "./payments.js";
const cfg = readConfig(),
  db = database(cfg.DATABASE_URL),
  mp = provider(cfg);
let stopping = false;
for (const s of ["SIGINT", "SIGTERM"])
  process.on(s, () => {
    stopping = true;
  });
while (!stopping) {
  const lock = await db.connect();
  try {
    if ((await one(lock, "SELECT pg_try_advisory_lock(987313) AS ok")).ok) {
      try {
        console.log(
          JSON.stringify({
            event: "reconcile",
            ...(await reconcile(db, cfg, mp)),
          }),
        );
      } finally {
        await lock.query("SELECT pg_advisory_unlock(987313)");
      }
    }
  } catch {
    console.error(JSON.stringify({ event: "worker_error" }));
  } finally {
    lock.release();
  }
  await new Promise((r) => setTimeout(r, cfg.WORKER_INTERVAL_MS));
}
await db.end();
