import { readConfig } from "./config.js";
import { database } from "./db.js";
import { createApp } from "./app.js";
const cfg = readConfig(),
  db = database(cfg.DATABASE_URL);
await db.query("SELECT 1 FROM settings LIMIT 1");
const server = createApp(db, cfg).listen(cfg.PORT, "0.0.0.0", () =>
  console.log(`Loja disponível em ${cfg.APP_URL}. Pagamentos: ${cfg.MP_MODE}.`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await db.end();
      process.exit(0);
    }),
  );
