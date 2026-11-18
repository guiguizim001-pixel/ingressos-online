import { randomBytes, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { one, tx } from "./db.js";
import { need } from "./validation.js";
// Called inside the payment transaction, with the parent order already locked.
export async function syncTickets(c, orderId) {
  const o = await one(c, "SELECT * FROM orders WHERE id=$1", [orderId]);
  if (o.order_kind !== "tickets") return;
  if (o.payment_status !== "approved" || !o.stock_committed || o.exception) {
    await c.query(
      "UPDATE tickets SET status='revoked' WHERE order_id=$1 AND status='valid'",
      [orderId],
    );
    return;
  }
  const items = (
    await c.query(
      "SELECT i.*,l.event_id FROM order_items i JOIN lots l ON l.id=i.lot_id WHERE i.order_id=$1 ORDER BY i.id",
      [orderId],
    )
  ).rows;
  for (const i of items) {
    for (let n = 0; n < i.quantity; n++) {
      await c.query(
        "INSERT INTO tickets(id,order_id,order_item_id,event_id,lot_id,ordinal,code,attendee_name) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(order_item_id,ordinal) DO NOTHING",
        [
          randomUUID(),
          orderId,
          i.id,
          i.event_id,
          i.lot_id,
          n + 1,
          "EVT-" + randomBytes(20).toString("hex").toUpperCase(),
          i.attendees[n] || o.contact.name,
        ],
      );
    }
  }
}
export async function customerTickets(db, orderId, uid) {
  need(
    await one(db, "SELECT id FROM orders WHERE id=$1 AND user_id=$2", [
      orderId,
      uid,
    ]),
    404,
    "Pedido não encontrado.",
  );
  const rows = (
    await db.query(
      "SELECT t.*,i.event_snapshot,i.lot_name,i.ticket_type,o.payment_status,o.exception,e.status AS event_status,e.starts_at AS current_starts_at,e.ends_at AS current_ends_at,e.venue AS current_venue,e.city AS current_city FROM tickets t JOIN order_items i ON i.id=t.order_item_id JOIN orders o ON o.id=t.order_id JOIN events e ON e.id=t.event_id WHERE t.order_id=$1 ORDER BY i.name,t.ordinal",
      [orderId],
    )
  ).rows;
  return Promise.all(
    rows.map(async (t) => ({
      ...t,
      usable:
        t.status === "valid" &&
        t.payment_status === "approved" &&
        !t.exception &&
        t.event_status === "published",
      qr: await QRCode.toDataURL(t.code, {
        width: 280,
        margin: 4,
        errorCorrectionLevel: "M",
      }),
    })),
  );
}
export async function checkTicket(
  db,
  { code, event_id },
  actorId,
  consume = false,
) {
  need(
    typeof code === "string" &&
      /^EVT-[A-F0-9]{40}$/.test(code.trim().toUpperCase()),
    400,
    "Código de ingresso inválido.",
  );
  return tx(db, async (c) => {
    const id = await one(c, "SELECT order_id FROM tickets WHERE code=$1", [
      code.trim().toUpperCase(),
    ]);
    need(id, 404, "Ingresso não encontrado.");
    const o = await one(c, "SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      id.order_id,
    ]);
    const t = await one(c, "SELECT * FROM tickets WHERE code=$1 FOR UPDATE", [
      code.trim().toUpperCase(),
    ]);
    need(
      t.event_id === event_id,
      409,
      "Este ingresso pertence a outro evento.",
    );
    const e = await one(c, "SELECT * FROM events WHERE id=$1 FOR SHARE", [
      event_id,
    ]);
    need(
      t.status !== "used",
      409,
      "Ingresso já utilizado. Entrada registrada anteriormente.",
    );
    need(
      t.status === "valid" &&
        o.payment_status === "approved" &&
        o.stock_committed &&
        !o.exception,
      409,
      "Ingresso bloqueado ou pagamento sem liberação.",
    );
    need(e.status === "published", 409, "Evento não liberado para entrada.");
    const now = new Date();
    need(
      e.checkin_opens_at &&
        now >= new Date(e.checkin_opens_at) &&
        now <= new Date(e.ends_at),
      409,
      "Fora do período de entrada do evento.",
    );
    if (consume)
      await c.query(
        "UPDATE tickets SET status='used',used_at=now(),checked_by=$2 WHERE id=$1",
        [t.id, actorId],
      );
    return {
      ok: true,
      consumed: consume,
      attendee_name: t.attendee_name,
      event_name: e.name,
      ticket_id: t.id,
      message: consume
        ? "Entrada confirmada."
        : "Ingresso válido. Confirme a entrada após conferir o participante.",
    };
  });
}
