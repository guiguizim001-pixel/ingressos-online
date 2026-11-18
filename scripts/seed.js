import { randomUUID, createHash } from "node:crypto";
import { readConfig } from "../src/config.js";
import { database, tx } from "../src/db.js";
const stable = (s) => {
  const h = createHash("md5")
    .update("ingressos-demo:" + s)
    .digest("hex");
  return (
    h.slice(0, 8) +
    "-" +
    h.slice(8, 12) +
    "-4" +
    h.slice(13, 16) +
    "-a" +
    h.slice(17, 20) +
    "-" +
    h.slice(20)
  );
};
export async function seed(db, mode) {
  if (!["development", "test"].includes(mode))
    throw Error("Exemplos permitidos apenas em desenvolvimento.");
  await tx(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(987314)");
    for (const name of ["Shows", "Festivais", "Experiências"])
      await c.query(
        "INSERT INTO categories(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [stable(name), name],
      );
    const data = [
      [
        "Festival Frequência",
        "Festivais",
        8990,
        "frequencia",
        "São Paulo · SP",
        "Arena Frequência",
        30,
      ],
      [
        "Noite em Movimento",
        "Shows",
        5990,
        "movimento",
        "Franca · SP",
        "Espaço Movimento",
        38,
      ],
      [
        "Horizonte Sessions",
        "Shows",
        6990,
        "horizonte",
        "Ribeirão Preto · SP",
        "Jardim Horizonte",
        45,
      ],
      [
        "Encontro Criativo",
        "Experiências",
        3990,
        "encontro",
        "Franca · SP",
        "Casa Criativa",
        52,
      ],
    ];
    for (const [name, category, price, asset, city, venue, days] of data) {
      const id = stable(asset),
        start = new Date(Date.now() + days * 86400000);
      start.setUTCHours(22, 0, 0, 0);
      const end = new Date(+start + 5 * 3600000),
        opens = new Date(+start - 2 * 3600000);
      const ins = await c.query(
        `INSERT INTO events(id,category_id,name,description,demo,starts_at,ends_at,checkin_opens_at,venue,city,address,organizer,rules,capacity,status) VALUES($1,$2,$3,$4,true,$5,$6,$7,$8,$9,'Endereço demonstrativo — substitua antes de publicar','Organização de exemplo','Evento fictício para validação. Não representa programação real. Cadastre classificação etária, acessibilidade, requisitos de entrada e política de cancelamento do seu evento.',200,'published') ON CONFLICT DO NOTHING RETURNING id`,
        [
          id,
          stable(category),
          name,
          "Viva a experiência de descobrir novos encontros, sons e histórias. Este é um evento de exemplo para você testar o sistema de ingressos.",
          start,
          end,
          opens,
          venue,
          city,
        ],
      );
      if (!ins.rowCount) continue;
      await c.query("INSERT INTO images(id,event_id,url) VALUES($1,$2,$3)", [
        randomUUID(),
        id,
        "/assets/" + asset + ".svg",
      ]);
      for (const [type, delta, stock] of [
        ["Pista", 0, 120],
        ["Área premium", 5000, 80],
      ]) {
        const lid = stable(asset + type);
        await c.query(
          `INSERT INTO lots(id,event_id,sku,lot_name,ticket_type,price_cents,stock,sales_start,sales_end,max_per_order) VALUES($1,$2,$3,'1º lote',$4,$5,$6,now()-interval '1 day',$7,10)`,
          [
            lid,
            id,
            "DEMO-" + asset + "-" + delta,
            type,
            price + delta,
            stock,
            start,
          ],
        );
        await c.query(
          "INSERT INTO inventory_movements(id,lot_id,delta,reason) VALUES($1,$2,$3,'development_seed')",
          [randomUUID(), lid, stock],
        );
      }
    }
  });
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/seed.js")) {
  const cfg = readConfig(),
    db = database(cfg.DATABASE_URL);
  try {
    await seed(db, cfg.NODE_ENV);
    console.log(
      "Eventos demonstrativos criados; dados existentes preservados.",
    );
  } finally {
    await db.end();
  }
}
