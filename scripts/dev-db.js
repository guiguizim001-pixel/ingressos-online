import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";
import { readConfig } from "../src/config.js";
const cfg = readConfig();
if (cfg.NODE_ENV !== "development")
  throw new Error("Banco local auxiliar permitido apenas em desenvolvimento.");
const url = new URL(cfg.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("DATABASE_URL precisa apontar para localhost.");
const pg = new EmbeddedPostgres({
  databaseDir: ".local-db",
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  port: Number(url.port || 5432),
  persistent: true,
  authMethod: "scram-sha-256",
  postgresFlags: [
    "-c",
    "listen_addresses=127.0.0.1",
    "-c",
    "unix_socket_directories=",
  ],
  onLog: () => {},
  onError: console.error,
});
if (!existsSync(".local-db/PG_VERSION")) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase(url.pathname.slice(1));
} catch (e) {
  if (e.code !== "42P04") throw e;
}
console.log("PostgreSQL local ativo. Mantenha esta janela aberta.");
let closed = false;
async function stop() {
  if (closed) return;
  closed = true;
  await pg.stop();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
