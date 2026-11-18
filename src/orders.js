import { randomUUID } from "node:crypto";
import { tx, one } from "./db.js";
import { orderSchema, need } from "./validation.js";
import { hashToken } from "./auth.js";
export async function quote(c, input, { lock = false } = {}) {
  const b = orderSchema.parse(input),
    grouped = new Map();
  for (const x of b.items) {
    const old = grouped.get(x.lot_id) || { quantity: 0, attendees: [] };
    old.quantity += x.quantity;
    old.attendees.push(...x.attendees);
    grouped.set(x.lot_id, old);
  }
  const ids = [...grouped.keys()].sort();
  // All purchase/approval paths lock event rows before lot rows, in UUID order.
  const events = (
    await c.query(
      `SELECT e.* FROM events e WHERE e.id IN(SELECT event_id FROM lots WHERE id=ANY($1::uuid[])) ORDER BY e.id ${lock ? "FOR UPDATE" : ""}`,
      [ids],
    )
  ).rows;
  const rows = (
    await c.query(
      `SELECT l.*,e.name,e.active AS event_active,COALESCE(cat.active,true) AS category_active FROM lots l JOIN events e ON e.id=l.event_id LEFT JOIN categories cat ON cat.id=e.category_id WHERE l.id=ANY($1::uuid[]) ORDER BY l.id ${lock ? "FOR UPDATE OF l" : ""}`,
      [ids],
    )
  ).rows;
  need(rows.length === ids.length, 400, "Lote não encontrado.");
  const now = new Date();
  const items = rows.map((l) => {
    const pick = grouped.get(l.id),
      e = events.find((e) => e.id === l.event_id);
    need(
      l.active &&
        l.event_active &&
        l.category_active &&
        e.status === "published",
      400,
      "Evento ou lote indisponível.",
    );
    need(
      e.starts_at && e.ends_at && e.capacity && now < new Date(e.starts_at),
      400,
      "As vendas deste evento foram encerradas.",
    );
    need(
      l.sales_start &&
        l.sales_end &&
        now >= new Date(l.sales_start) &&
        now < new Date(l.sales_end),
      400,
      "Este lote está fora do período de venda.",
    );
    need(
      pick.quantity <= l.max_per_order,
      400,
      `Limite de ${l.max_per_order} ingressos neste lote por pedido.`,
    );
    need(
      l.stock - l.reserved >= pick.quantity,
      409,
      `Ingressos insuficientes em ${e.name} · ${l.lot_name} / ${l.ticket_type}.`,
    );
    return {
      ...l,
      ...pick,
      event_snapshot: {
        id: e.id,
        name: e.name,
        starts_at: e.starts_at,
        ends_at: e.ends_at,
        venue: e.venue,
        city: e.city,
        address: e.address,
        organizer: e.organizer,
        rules: e.rules,
      },
    };
  });
  for (const e of events) {
    const used = await one(
      c,
      `SELECT (SELECT COALESCE(sum(i.quantity),0) FROM order_items i JOIN lots l ON l.id=i.lot_id JOIN orders o ON o.id=i.order_id WHERE l.event_id=$1 AND o.stock_committed AND o.order_kind='tickets')+(SELECT COALESCE(sum(r.quantity),0) FROM reservations r JOIN lots l ON l.id=r.lot_id WHERE l.event_id=$1 AND r.status='held') AS occupied`,
      [e.id],
    );
    need(
      Number(used.occupied) +
        items
          .filter((i) => i.event_id === e.id)
          .reduce((n, i) => n + i.quantity, 0) <=
        e.capacity,
      409,
      "Capacidade total do evento esgotada.",
    );
  }
  const settings = (await one(c, "SELECT data FROM settings WHERE id=1")).data;
  const subtotal = items.reduce((s, i) => s + i.quantity * i.price_cents, 0),
    discount = Math.floor((subtotal * settings.discount_percent) / 100),
    total = subtotal - discount;
  need(
    Number.isSafeInteger(total) && total > 0 && total <= 100000000,
    400,
    "Valor do pedido fora do limite.",
  );
  return {
    items,
    subtotal_cents: subtotal,
    discount_cents: discount,
    shipping_cents: 0,
    total_cents: total,
    delivery: { method: "digital" },
    contact: b.contact,
  };
}
export async function createOrder(db, cfg, uid, key, input) {
  need(
    typeof key === "string" && /^[a-zA-Z0-9-]{16,80}$/.test(key),
    400,
    "Identificador de compra inválido.",
  );
  const b = orderSchema.parse(input);
  b.items.sort((a, b) => a.lot_id.localeCompare(b.lot_id));
  const fingerprint = hashToken(JSON.stringify(b));
  return tx(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      uid + ":" + key,
    ]);
    const old = await one(
      c,
      "SELECT * FROM orders WHERE user_id=$1 AND idem_key=$2",
      [uid, key],
    );
    if (old) {
      need(
        old.request_hash === fingerprint,
        409,
        "Esta chave já foi usada em outra compra.",
      );
      return old;
    }
    const q = await quote(c, b, { lock: true }),
      id = randomUUID(),
      expiry = new Date(
        Math.min(
          Date.now() + cfg.RESERVATION_MINUTES * 60000,
          ...q.items.map((i) => new Date(i.sales_end).getTime()),
          ...q.items.map((i) => new Date(i.event_snapshot.starts_at).getTime()),
        ),
      );
    need(
      b.expected_total_cents === undefined ||
        b.expected_total_cents === q.total_cents,
      409,
      "O total mudou. Calcule novamente e confira os valores antes de pagar.",
    );
    const row = await one(
      c,
      "INSERT INTO orders(id,user_id,idem_key,request_hash,subtotal_cents,discount_cents,shipping_cents,total_cents,delivery,contact,expires_at,order_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'tickets') RETURNING *",
      [
        id,
        uid,
        key,
        fingerprint,
        q.subtotal_cents,
        q.discount_cents,
        q.shipping_cents,
        q.total_cents,
        q.delivery,
        q.contact,
        expiry,
      ],
    );
    for (const i of q.items) {
      await c.query(
        "INSERT INTO order_items(id,order_id,lot_id,name,sku,lot_name,ticket_type,quantity,price_cents,event_snapshot,attendees) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          randomUUID(),
          id,
          i.id,
          i.name,
          i.sku,
          i.lot_name,
          i.ticket_type,
          i.quantity,
          i.price_cents,
          i.event_snapshot,
          JSON.stringify(i.attendees),
        ],
      );
      await c.query("UPDATE lots SET reserved=reserved+$2 WHERE id=$1", [
        i.id,
        i.quantity,
      ]);
      await c.query(
        "INSERT INTO reservations(id,order_id,lot_id,quantity,expires_at) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), id, i.id, i.quantity, expiry],
      );
    }
    await c.query("INSERT INTO payment_attempts(id,order_id) VALUES($1,$2)", [
      randomUUID(),
      id,
    ]);
    return row;
  });
}
export async function releaseOrder(c, id) {
  const { rows } = await c.query(
    "SELECT r.* FROM reservations r JOIN lots v ON v.id=r.lot_id WHERE r.order_id=$1 AND r.status='held' ORDER BY v.id FOR UPDATE OF v",
    [id],
  );
  for (const r of rows) {
    await c.query("UPDATE lots SET reserved=reserved-$2 WHERE id=$1", [
      r.lot_id,
      r.quantity,
    ]);
    await c.query("UPDATE reservations SET status='released' WHERE id=$1", [
      r.id,
    ]);
  }
}
export async function expireReservations(db) {
  return tx(db, async (c) => {
    const { rows } = await c.query(
      "SELECT * FROM orders WHERE expires_at<=now() AND stock_committed=false AND EXISTS(SELECT 1 FROM reservations r WHERE r.order_id=orders.id AND r.status='held') ORDER BY id FOR UPDATE SKIP LOCKED",
    );
    for (const o of rows) {
      await releaseOrder(c, o.id);
      await c.query(
        "UPDATE orders SET payment_status=CASE WHEN payment_status='pending' THEN 'cancelled' ELSE payment_status END,updated_at=now() WHERE id=$1",
        [o.id],
      );
    }
    return rows.length;
  });
}
export async function orderDetails(db, id, uid) {
  const o = await one(
    db,
    "SELECT * FROM orders WHERE id=$1" + (uid ? " AND user_id=$2" : ""),
    uid ? [id, uid] : [id],
  );
  need(o, 404, "Pedido não encontrado.");
  o.items = (
    await db.query(
      "SELECT * FROM order_items WHERE order_id=$1 ORDER BY name",
      [id],
    )
  ).rows;
  o.payments = (
    await db.query(
      "SELECT provider_id,provider_status,status,amount_cents,refunded_cents FROM payments WHERE order_id=$1",
      [id],
    )
  ).rows;
  o.attempt = await one(
    db,
    "SELECT state,preference_id,checkout_url FROM payment_attempts WHERE order_id=$1",
    [id],
  );
  return o;
}
