import { readdir, readFile } from "node:fs/promises";
import { readConfig } from "../src/config.js";
import { database, tx } from "../src/db.js";
export async function migrate(db) {
  await tx(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(987312)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
    );
    for (const name of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        (await c.query("SELECT 1 FROM migrations WHERE name=$1", [name]))
          .rowCount
      )
        continue;
      await c.query(
        await readFile(
          new URL("../migrations/" + name, import.meta.url),
          "utf8",
        ),
      );
      await c.query("INSERT INTO migrations(name) VALUES($1)", [name]);
    }
  });
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/migrate.js")) {
  const db = database(readConfig().DATABASE_URL);
  try {
    await migrate(db);
    console.log("Banco atualizado.");
  } finally {
    await db.end();
  }
}
