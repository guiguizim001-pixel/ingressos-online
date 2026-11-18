import { readConfig } from "../src/config.js";
import { database } from "../src/db.js";
import { provider, reconcile } from "../src/payments.js";
import { uuid } from "../src/validation.js";
const cfg = readConfig(),
  db = database(cfg.DATABASE_URL);
try {
  const result = await reconcile(
    db,
    cfg,
    provider(cfg),
    process.argv[2] ? uuid.parse(process.argv[2]) : undefined,
  );
  console.log(result);
  if (result.errors) process.exitCode = 1;
} finally {
  await db.end();
}
