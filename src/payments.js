import { randomUUID } from "node:crypto";
import { WebhookSignatureValidator } from "mercadopago";
import { one, tx } from "./db.js";
import { hashToken } from "./auth.js";
import { need, uuid } from "./validation.js";
import { syncTickets } from "./tickets.js";
import { releaseOrder, expireReservations } from "./orders.js";
export const enabled = (cfg) => cfg.MP_MODE !== "disabled";
export function provider(cfg, fetcher = fetch) {
  async function call(path, { method = "GET", body } = {}) {
    const r = await fetcher("https://api.mercadopago.com" + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) {
      const e = new Error("Mercado Pago indisponível.");
      e.code = "MP_HTTP_" + r.status;
      throw e;
    }
    return r.json();
  }
  return { call };
}
export function verifyWebhook(req, cfg) {
  const id = req.query["data.id"];
  need(enabled(cfg), 503, "Pagamentos desabilitados.");
  need(
    typeof id === "string" &&
      /^\d{1,30}$/.test(id) &&
      typeof req.get("x-request-id") === "string",
    401,
    "Assinatura inválida.",
  );
  try {
    WebhookSignatureValidator.validate({
      xSignature: req.get("x-signature"),
      xRequestId: req.get("x-request-id"),
      dataId: id,
      secret: cfg.MP_WEBHOOK_SECRET,
    });
  } catch {
    need(false, 401, "Assinatura inválida.");
  }
  need(
    !req.body?.data?.id || String(req.body.data.id) === id,
    400,
    "Notificação inconsistente.",
  );
  return {
    id,
    eventKey: hashToken(
      id + "|" + req.get("x-request-id") + "|" + req.get("x-signature"),
    ),
  };
}
export function preferenceBody(o, items, cfg) {
  let remaining = o.subtotal_cents - o.discount_cents;
  let mpItems = items.map((i, n) => {
    const cents =
      n === items.length - 1
        ? remaining
        : Math.floor(
            (i.price_cents *
              i.quantity *
              (o.subtotal_cents - o.discount_cents)) /
              o.subtotal_cents,
          );
    remaining -= cents;
    return {
      id: i.lot_id,
      title:
        `${i.quantity} × ${i.name} · ${i.lot_name} / ${i.ticket_type}`.slice(
          0,
          250,
        ),
      quantity: 1,
      currency_id: "BRL",
      unit_price: cents / 100,
    };
  });
  // Tiny prices can round a discounted line to zero; send one positive bundle.
  if (mpItems.some((i) => i.unit_price <= 0)) {
    mpItems = [
      {
        id: o.id,
        title: "Ingressos do pedido " + o.id.slice(0, 8),
        quantity: 1,
        currency_id: "BRL",
        unit_price: (o.subtotal_cents - o.discount_cents) / 100,
      },
    ];
  }
  if (o.shipping_cents)
    mpItems.push({
      id: "delivery",
      title: "Entrega — tabela da loja",
      quantity: 1,
      currency_id: "BRL",
      unit_price: o.shipping_cents / 100,
    });
  const back = cfg.APP_URL + "/?order=" + o.id;
  return {
    items: mpItems,
    external_reference: o.id,
    metadata: { order_id: o.id },
    back_urls: { success: back, pending: back, failure: back },
    auto_return: "approved",
    notification_url: cfg.APP_URL + "/api/webhooks/mercadopago",
    expires: true,
    expiration_date_from: new Date(o.created_at).toISOString(),
    expiration_date_to: new Date(o.expires_at).toISOString(),
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }, { id: "atm" }],
    },
  };
}
function safeCheckout(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      (u.hostname === "mercadopago.com" ||
        u.hostname.endsWith(".mercadopago.com") ||
        u.hostname === "mercadopago.com.br" ||
        u.hostname.endsWith(".mercadopago.com.br"))
    );
  } catch {
    return false;
  }
}
export async function ensurePreference(db, cfg, mp, id) {
  need(enabled(cfg), 503, "Configure o Mercado Pago para iniciar pagamentos.");
  const c = await db.connect();
  let locked = false;
  try {
    locked = (
      await one(
        c,
        "SELECT pg_try_advisory_lock(hashtextextended($1,1)) AS ok",
        [id],
      )
    ).ok;
    need(
      locked,
      409,
      "Pagamento sendo preparado. Aguarde e consulte seu pedido.",
    );
    const o = await one(c, "SELECT * FROM orders WHERE id=$1", [id]),
      a = await one(c, "SELECT * FROM payment_attempts WHERE order_id=$1", [
        id,
      ]);
    need(o && a, 404, "Pedido não encontrado.");
    need(
      new Date(o.expires_at) > new Date(),
      409,
      "Reserva expirada. Inicie uma nova compra.",
    );
    need(
      !o.stock_committed && o.payment_status !== "approved",
      409,
      "Este pedido já foi pago.",
    );
    if (a.checkout_url) return { checkout_url: a.checkout_url };
    let p;
    if (a.state !== "new") {
      const found = await mp.call(
        "/checkout/preferences/search?external_reference=" +
          encodeURIComponent(id) +
          "&limit=100",
      );
      const matches = (found.elements || []).filter(
        (x) =>
          x.external_reference === id &&
          String(x.collector_id) === cfg.MP_COLLECTOR_ID,
      );
      need(
        matches.length <= 1,
        409,
        "Mais de uma preferência localizada. Procure o atendimento.",
      );
      if (matches.length)
        p = await mp.call(
          "/checkout/preferences/" + encodeURIComponent(matches[0].id),
        );
      else
        return {
          pending: true,
          message:
            "Aguardando confirmação do Mercado Pago. A reconciliação verificará novamente; não crie outra cobrança.",
        };
    } else {
      // Persist before network I/O. A crash or timeout must never blindly repeat POST.
      await c.query(
        "UPDATE payment_attempts SET state='creating',tries=tries+1,updated_at=now() WHERE order_id=$1",
        [id],
      );
      try {
        const items = (
          await c.query(
            "SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",
            [id],
          )
        ).rows;
        p = await mp.call("/checkout/preferences", {
          method: "POST",
          body: preferenceBody(o, items, cfg),
        });
      } catch {
        await c.query(
          "UPDATE payment_attempts SET state='uncertain',last_error='provider_unavailable',updated_at=now() WHERE order_id=$1",
          [id],
        );
        return {
          pending: true,
          message:
            "O provedor não confirmou a criação. Consulte este pedido novamente em instantes.",
        };
      }
    }
    need(
      p?.id &&
        p.external_reference === id &&
        String(p.collector_id) === cfg.MP_COLLECTOR_ID &&
        safeCheckout(p.init_point),
      502,
      "Resposta inesperada do provedor. Aguarde a reconciliação.",
    );
    await c.query(
      "UPDATE payment_attempts SET state='ready',preference_id=$2,checkout_url=$3,last_error=NULL,updated_at=now() WHERE order_id=$1",
      [id, String(p.id), p.init_point],
    );
    return { checkout_url: p.init_point };
  } finally {
    if (locked)
      await c.query("SELECT pg_advisory_unlock(hashtextextended($1,1))", [id]);
    c.release();
  }
}
export function moneyCents(v) {
  const s = String(v);
  need(/^\d+(\.\d{1,2})?$/.test(s), 422, "Valor inválido do provedor.");
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  need(Number.isSafeInteger(n), 422, "Valor inválido do provedor.");
  return n;
}
const stateMap = {
  approved: "approved",
  pending: "pending",
  in_process: "pending",
  authorized: "pending",
  rejected: "rejected",
  cancelled: "cancelled",
  refunded: "refunded",
  charged_back: "disputed",
  in_mediation: "disputed",
};
export async function applyPayment(db, cfg, p) {
  const id = uuid.safeParse(p.external_reference);
  need(id.success, 422, "Vinculação inválida.");
  need(/^\d{1,30}$/.test(String(p.id)), 422, "Identificador inválido.");
  const amount = moneyCents(p.transaction_amount),
    refunded = moneyCents(p.transaction_amount_refunded || 0),
    updated = new Date(p.date_last_updated);
  need(
    stateMap[p.status] && Number.isFinite(updated.getTime()),
    422,
    "Estado ou data inválidos.",
  );
  return tx(db, async (c) => {
    const o = await one(c, "SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
      id.data,
    ]);
    need(o, 422, "Pedido não localizado.");
    need(
      p.currency_id === "BRL" &&
        String(p.collector_id) === cfg.MP_COLLECTOR_ID &&
        typeof p.live_mode === "boolean" &&
        p.live_mode === (cfg.MP_MODE === "production") &&
        amount === o.total_cents &&
        refunded <= amount,
      422,
      "Pagamento divergente: valor, moeda, recebedor ou ambiente.",
    );
    const old = await one(c, "SELECT * FROM payments WHERE provider_id=$1", [
      String(p.id),
    ]);
    need(
      !old || old.order_id === o.id,
      422,
      "Pagamento vinculado a outro pedido.",
    );
    if (old && new Date(old.provider_updated_at) >= updated)
      return { ignored: true };
    await c.query(
      "INSERT INTO payments(provider_id,order_id,provider_status,status,amount_cents,refunded_cents,provider_updated_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(provider_id) DO UPDATE SET provider_status=$3,status=$4,amount_cents=$5,refunded_cents=$6,provider_updated_at=$7,updated_at=now()",
      [
        String(p.id),
        o.id,
        p.status,
        stateMap[p.status],
        amount,
        refunded,
        updated,
      ],
    );
    const all = (
      await c.query(
        "SELECT * FROM payments WHERE order_id=$1 ORDER BY provider_updated_at DESC",
        [o.id],
      )
    ).rows;
    const paid = all.filter((x) =>
      ["approved", "refunded", "disputed"].includes(x.status),
    );
    let status = all[0].status,
      fulfillment = o.fulfillment_status,
      exception = o.exception;
    if (paid.length) {
      status = paid.some((x) => x.status === "disputed")
        ? "disputed"
        : paid.some((x) => x.status === "approved")
          ? "approved"
          : "refunded";
    }
    if (paid.length > 1) {
      exception = "multiple_payments";
      fulfillment = "blocked";
    }
    if (status === "approved" && !o.stock_committed) {
      let eventAvailable = true,
        capacityAvailable = true;
      if (o.order_kind === "tickets") {
        const events = (
          await c.query(
            "SELECT e.* FROM events e WHERE e.id IN(SELECT l.event_id FROM order_items i JOIN lots l ON l.id=i.lot_id WHERE i.order_id=$1) ORDER BY e.id FOR UPDATE",
            [o.id],
          )
        ).rows;
        eventAvailable =
          events.length > 0 &&
          events.every(
            (e) =>
              e.active &&
              e.status === "published" &&
              new Date(e.starts_at) > new Date(),
          );
        for (const e of events) {
          const count = await one(
            c,
            `SELECT (SELECT COALESCE(sum(i.quantity),0) FROM order_items i JOIN lots l ON l.id=i.lot_id JOIN orders x ON x.id=i.order_id WHERE l.event_id=$1 AND x.stock_committed AND x.order_kind='tickets')+(SELECT COALESCE(sum(r.quantity),0) FROM reservations r JOIN lots l ON l.id=r.lot_id WHERE l.event_id=$1 AND r.status='held' AND r.order_id<>$2)+(SELECT COALESCE(sum(i.quantity),0) FROM order_items i JOIN lots l ON l.id=i.lot_id WHERE l.event_id=$1 AND i.order_id=$2) AS n`,
            [e.id, o.id],
          );
          if (Number(count.n) > e.capacity) capacityAvailable = false;
        }
      }
      const items = (
        await c.query(
          "SELECT i.*,v.stock,v.reserved,r.status AS reservation_status FROM order_items i JOIN lots v ON v.id=i.lot_id JOIN reservations r ON r.order_id=i.order_id AND r.lot_id=i.lot_id WHERE i.order_id=$1 ORDER BY v.id FOR UPDATE OF v",
          [o.id],
        )
      ).rows;
      const hasStock = items.every(
        (i) =>
          (i.reservation_status === "held" ? i.stock : i.stock - i.reserved) >=
          i.quantity,
      );
      if (hasStock && eventAvailable && capacityAvailable) {
        for (const i of items) {
          await c.query(
            "UPDATE lots SET stock=stock-$2,reserved=reserved-$3 WHERE id=$1",
            [
              i.lot_id,
              i.quantity,
              i.reservation_status === "held" ? i.quantity : 0,
            ],
          );
          await c.query(
            "UPDATE reservations SET status='consumed' WHERE order_id=$1 AND lot_id=$2",
            [o.id, i.lot_id],
          );
          await c.query(
            "INSERT INTO inventory_movements(id,lot_id,order_id,delta,reason) VALUES($1,$2,$3,$4,'sale')",
            [randomUUID(), i.lot_id, o.id, -i.quantity],
          );
        }
        await c.query("UPDATE orders SET stock_committed=true WHERE id=$1", [
          o.id,
        ]);
        if (!exception) fulfillment = "ready";
      } else {
        exception = !eventAvailable
          ? "event_unavailable"
          : !capacityAvailable
            ? "event_capacity_exceeded"
            : "late_payment_no_stock";
        fulfillment = "blocked";
        await releaseOrder(c, o.id);
      }
    }
    if (
      ["refunded", "disputed"].includes(status) ||
      all.some((x) => x.refunded_cents > 0)
    ) {
      fulfillment = "blocked";
      exception = exception || "refund_or_dispute_review";
      await releaseOrder(c, o.id);
    }
    // Rejected attempts may be retried within the same preference. Keep reservation until expiry.
    await c.query(
      "UPDATE orders SET payment_status=$2,fulfillment_status=$3,exception=$4,updated_at=now() WHERE id=$1",
      [o.id, status, fulfillment, exception],
    );
    await syncTickets(c, o.id);
    return { status };
  });
}
export async function processEvents(db, cfg, mp) {
  let processed = 0;
  for (let n = 0; n < 30; n++) {
    const e = await tx(db, async (c) => {
      const row = await one(
        c,
        "SELECT * FROM webhook_events WHERE state IN('pending','retry','processing') AND next_attempt_at<=now() ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1",
      );
      if (row)
        await c.query(
          "UPDATE webhook_events SET state='processing',attempts=attempts+1,next_attempt_at=now()+interval '2 minutes' WHERE id=$1",
          [row.id],
        );
      return row;
    });
    if (!e) break;
    try {
      const p = await mp.call(
        "/v1/payments/" + encodeURIComponent(e.payment_id),
      );
      need(String(p.id) === e.payment_id, 422, "Identificador divergente.");
      await applyPayment(db, cfg, p);
      await db.query(
        "UPDATE webhook_events SET state='done',processed_at=now(),error=NULL WHERE id=$1",
        [e.id],
      );
      processed++;
    } catch (err) {
      const permanent = err.status === 422;
      await db.query(
        "UPDATE webhook_events SET state=$2,error=$3,next_attempt_at=now()+($4 * interval '1 second') WHERE id=$1",
        [
          e.id,
          permanent ? "quarantined" : "retry",
          permanent ? "payment_mismatch" : "provider_unavailable",
          Math.min(3600, 30 * 2 ** Math.min(e.attempts, 7)),
        ],
      );
    }
  }
  return processed;
}
export async function reconcile(db, cfg, mp, onlyId) {
  const expired = await expireReservations(db);
  if (!enabled(cfg)) return { expired, processed: 0, reconciled: 0, errors: 0 };
  const processed = await processEvents(db, cfg, mp);
  let reconciled = 0,
    errors = 0;
  const orders = (
    await db.query(
      "SELECT id FROM orders " +
        (onlyId ? "WHERE id=$1 " : "") +
        "ORDER BY reconciled_at ASC NULLS FIRST LIMIT 30",
      onlyId ? [onlyId] : [],
    )
  ).rows;
  for (const o of orders) {
    try {
      const a = await one(
        db,
        "SELECT * FROM payment_attempts WHERE order_id=$1",
        [o.id],
      );
      const order = await one(db, "SELECT * FROM orders WHERE id=$1", [o.id]);
      if (
        a &&
        ["creating", "uncertain"].includes(a.state) &&
        new Date(order.expires_at) > new Date()
      )
        await ensurePreference(db, cfg, mp, o.id);
      let offset = 0,
        total = 0;
      do {
        const data = await mp.call(
          "/v1/payments/search?sort=date_created&criteria=desc&external_reference=" +
            o.id +
            "&limit=100&offset=" +
            offset,
        );
        for (const p of data.results || []) {
          need(p.external_reference === o.id, 422, "Referência divergente.");
          const fresh = await mp.call(
            "/v1/payments/" + encodeURIComponent(p.id),
          );
          await applyPayment(db, cfg, fresh);
        }
        total = data.paging?.total || 0;
        offset += 100;
      } while (offset < total && offset < 1000);
      reconciled++;
    } catch {
      errors++;
    } finally {
      await db.query("UPDATE orders SET reconciled_at=now() WHERE id=$1", [
        o.id,
      ]);
    }
  }
  await db.query("DELETE FROM sessions WHERE expires_at<now()");
  await db.query(
    "DELETE FROM password_tokens WHERE expires_at<now()-interval '1 day'",
  );
  await db.query("DELETE FROM auth_limits WHERE until_at<now()");
  return { expired, processed, reconciled, errors };
}
