import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { one, tx } from "./db.js";
import { auth, requireUser, requireAdmin } from "./auth.js";
import {
  HttpError,
  uuid,
  short,
  eventSchema,
  lotSchema,
  settingsSchema,
  need,
} from "./validation.js";
import { quote, createOrder, orderDetails } from "./orders.js";
import {
  enabled,
  provider,
  verifyWebhook,
  ensurePreference,
  reconcile,
} from "./payments.js";
import { customerTickets, checkTicket } from "./tickets.js";
import { storeImage } from "./storage.js";
const root = fileURLToPath(new URL("../", import.meta.url));
export function createApp(db, cfg, deps = {}) {
  const app = express(),
    mp = deps.mp || provider(cfg);
  app.disable("x-powered-by");
  if (cfg.TRUST_PROXY) app.set("trust proxy", cfg.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "https:", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: cfg.NODE_ENV === "production" ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.get("/health", async (req, res) => {
    await db.query("SELECT 1");
    res.json({ ok: true });
  });
  const webLimit = rateLimit({
    windowMs: 60000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Muitas solicitações. Aguarde um minuto." },
  });
  app.post("/api/webhooks/mercadopago", webLimit, async (req, res) => {
    const e = verifyWebhook(req, cfg);
    if (req.body?.type && req.body.type !== "payment")
      return res.sendStatus(200);
    await db.query(
      "INSERT INTO webhook_events(id,payment_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [e.eventKey, e.id],
    );
    res.sendStatus(200);
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Muitas solicitações. Aguarde um minuto." },
    }),
  );
  auth(app, db, cfg, deps);
  app.get("/api/store", async (req, res) => {
    const settings = (await one(db, "SELECT data FROM settings WHERE id=1"))
      .data;
    res.json({
      settings,
      local_easy: cfg.LOCAL_EASY === true,
      payment: { enabled: enabled(cfg), mode: cfg.MP_MODE },
      categories: (
        await db.query("SELECT * FROM categories WHERE active ORDER BY name")
      ).rows,
    });
  });
  app.get("/api/events", async (req, res) => {
    res.json(await catalog(db, false));
  });
  app.get("/api/profile", requireUser, (req, res) => res.json(req.user));
  app.patch("/api/profile", requireUser, async (req, res) => {
    const b = z
      .object({ name: short, phone: z.string().max(30) })
      .parse(req.body);
    await db.query("UPDATE users SET name=$1,phone=$2 WHERE id=$3", [
      b.name,
      b.phone,
      req.user.id,
    ]);
    res.json({ ok: true });
  });
  app.post("/api/quote", requireUser, async (req, res) => {
    const q = await quote(db, req.body);
    res.json({
      subtotal_cents: q.subtotal_cents,
      discount_cents: q.discount_cents,
      shipping_cents: q.shipping_cents,
      total_cents: q.total_cents,
      delivery: q.delivery,
    });
  });
  app.post("/api/orders", requireUser, async (req, res) => {
    need(
      enabled(cfg),
      503,
      "Pagamento indisponível: configure o Mercado Pago antes de criar pedidos.",
    );
    const o = await createOrder(
      db,
      cfg,
      req.user.id,
      req.get("idempotency-key"),
      req.body,
    );
    res
      .status(201)
      .json({ order_id: o.id, ...(await ensurePreference(db, cfg, mp, o.id)) });
  });
  app.get("/api/orders", requireUser, async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT id,total_cents,payment_status,fulfillment_status,created_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",
          [req.user.id],
        )
      ).rows,
    ),
  );
  app.get("/api/orders/:id", requireUser, async (req, res) =>
    res.json(await orderDetails(db, uuid.parse(req.params.id), req.user.id)),
  );
  app.post("/api/orders/:id/payment", requireUser, async (req, res) => {
    const id = uuid.parse(req.params.id);
    await orderDetails(db, id, req.user.id);
    res.json(await ensurePreference(db, cfg, mp, id));
  });
  app.get("/api/orders/:id/tickets", requireUser, async (req, res) =>
    res.json(await customerTickets(db, uuid.parse(req.params.id), req.user.id)),
  );
  app.use("/api/admin", requireAdmin);
  const entrySchema = z.object({ code: z.string().max(100), event_id: uuid });
  app.post("/api/admin/checkin/verify", async (req, res) =>
    res.json(
      await checkTicket(db, entrySchema.parse(req.body), req.user.id, false),
    ),
  );
  app.post("/api/admin/checkin/confirm", async (req, res) =>
    res.json(
      await checkTicket(db, entrySchema.parse(req.body), req.user.id, true),
    ),
  );
  app.get("/api/admin/events/:id/attendees", async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT t.id,t.attendee_name,t.status,t.issued_at,t.used_at,t.order_id,l.lot_name,l.ticket_type FROM tickets t JOIN lots l ON l.id=t.lot_id WHERE t.event_id=$1 ORDER BY t.attendee_name,t.id",
          [uuid.parse(req.params.id)],
        )
      ).rows,
    ),
  );
  app.get("/api/admin/dashboard", async (req, res) => {
    const stats = (
      await db.query(
        "SELECT payment_status,count(*)::int AS count,COALESCE(sum(total_cents),0)::bigint AS cents FROM orders GROUP BY payment_status",
      )
    ).rows;
    const refund = await one(
      db,
      "SELECT COALESCE(sum(refunded_cents),0)::bigint AS cents FROM payments",
    );
    const work = (
      await db.query(
        "SELECT state,count(*)::int AS count FROM webhook_events GROUP BY state",
      )
    ).rows;
    res.json({
      stats,
      tickets: (
        await db.query(
          "SELECT status,count(*)::int AS count FROM tickets GROUP BY status",
        )
      ).rows,
      refund_cents: Number(refund.cents),
      webhooks: work,
      exceptions: (
        await one(
          db,
          "SELECT count(*)::int AS count FROM orders WHERE exception IS NOT NULL",
        )
      ).count,
    });
  });
  app.get("/api/admin/events", async (req, res) =>
    res.json(await catalog(db, true)),
  );
  const eventFields = [
    "category_id",
    "name",
    "description",
    "active",
    "demo",
    "starts_at",
    "ends_at",
    "checkin_opens_at",
    "venue",
    "city",
    "address",
    "organizer",
    "rules",
    "capacity",
    "status",
  ];
  app.post("/api/admin/events", async (req, res) => {
    const b = eventSchema.parse(req.body),
      id = randomUUID();
    res
      .status(201)
      .json(
        await one(
          db,
          `INSERT INTO events(id,${eventFields.join(",")}) VALUES($1,${eventFields.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING *`,
          [id, ...eventFields.map((k) => b[k])],
        ),
      );
  });
  app.put("/api/admin/events/:id", async (req, res) => {
    const b = eventSchema.parse(req.body),
      id = uuid.parse(req.params.id);
    await tx(db, async (c) => {
      need(
        await one(c, "SELECT id FROM events WHERE id=$1 FOR UPDATE", [id]),
        404,
        "Evento não encontrado.",
      );
      const occupied = await one(
        c,
        `SELECT (SELECT COALESCE(sum(i.quantity),0) FROM order_items i JOIN lots l ON l.id=i.lot_id JOIN orders o ON o.id=i.order_id WHERE l.event_id=$1 AND o.stock_committed AND o.order_kind='tickets')+(SELECT COALESCE(sum(r.quantity),0) FROM reservations r JOIN lots l ON l.id=r.lot_id WHERE l.event_id=$1 AND r.status='held') AS n`,
        [id],
      );
      need(
        b.capacity >= Number(occupied.n),
        409,
        "A capacidade não pode ser menor que os ingressos vendidos e reservados.",
      );
      await c.query(
        `UPDATE events SET ${eventFields.map((k, i) => k + "=$" + (i + 2)).join(",")} WHERE id=$1`,
        [id, ...eventFields.map((k) => b[k])],
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/admin/categories", async (req, res) =>
    res.json((await db.query("SELECT * FROM categories ORDER BY name")).rows),
  );
  app.post("/api/admin/categories", async (req, res) => {
    const b = z.object({ name: short, active: z.boolean() }).parse(req.body);
    res
      .status(201)
      .json(
        await one(
          db,
          "INSERT INTO categories(id,name,active) VALUES($1,$2,$3) RETURNING *",
          [randomUUID(), b.name, b.active],
        ),
      );
  });
  app.put("/api/admin/categories/:id", async (req, res) => {
    const b = z.object({ name: short, active: z.boolean() }).parse(req.body);
    const r = await db.query(
      "UPDATE categories SET name=$1,active=$2 WHERE id=$3",
      [b.name, b.active, uuid.parse(req.params.id)],
    );
    need(r.rowCount, 404, "Categoria não encontrada.");
    res.json({ ok: true });
  });
  const lotFields = [
    "sku",
    "lot_name",
    "ticket_type",
    "price_cents",
    "active",
    "sales_start",
    "sales_end",
    "max_per_order",
  ];
  app.post("/api/admin/events/:id/lots", async (req, res) => {
    const b = lotSchema.parse(req.body),
      eventId = uuid.parse(req.params.id);
    const result = await tx(db, async (c) => {
      const e = await one(c, "SELECT * FROM events WHERE id=$1 FOR UPDATE", [
        eventId,
      ]);
      need(e, 404, "Evento não encontrado.");
      need(
        new Date(b.sales_end) <= new Date(e.starts_at),
        400,
        "Encerre as vendas até o início do evento.",
      );
      return one(
        c,
        `INSERT INTO lots(id,event_id,${lotFields.join(",")}) VALUES($1,$2,${lotFields.map((_, i) => "$" + (i + 3)).join(",")}) RETURNING *`,
        [randomUUID(), eventId, ...lotFields.map((k) => b[k])],
      );
    });
    res.status(201).json(result);
  });
  app.put("/api/admin/lots/:id", async (req, res) => {
    const b = lotSchema.parse(req.body),
      id = uuid.parse(req.params.id);
    await tx(db, async (c) => {
      const l = await one(c, "SELECT event_id FROM lots WHERE id=$1", [id]);
      need(l, 404, "Lote não encontrado.");
      const e = await one(c, "SELECT * FROM events WHERE id=$1 FOR UPDATE", [
        l.event_id,
      ]);
      need(
        new Date(b.sales_end) <= new Date(e.starts_at),
        400,
        "Encerre as vendas até o início do evento.",
      );
      await c.query(
        `UPDATE lots SET ${lotFields.map((k, i) => k + "=$" + (i + 2)).join(",")} WHERE id=$1`,
        [id, ...lotFields.map((k) => b[k])],
      );
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/lots/:id/stock", async (req, res) => {
    const b = z
      .object({
        delta: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((n) => n !== 0),
        reason: short,
      })
      .parse(req.body);
    const id = uuid.parse(req.params.id);
    await tx(db, async (c) => {
      const v = await one(c, "SELECT * FROM lots WHERE id=$1 FOR UPDATE", [id]);
      need(v, 404, "Lote não encontrado.");
      need(
        v.stock + b.delta >= v.reserved,
        409,
        "O ajuste deixaria estoque menor que as reservas.",
      );
      await c.query("UPDATE lots SET stock=stock+$2 WHERE id=$1", [
        id,
        b.delta,
      ]);
      await c.query(
        "INSERT INTO inventory_movements(id,lot_id,actor_id,delta,reason) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), id, req.user.id, b.delta, "adjustment: " + b.reason],
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/admin/lots/:id/movements", async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM inventory_movements WHERE lot_id=$1 ORDER BY created_at DESC LIMIT 200",
          [uuid.parse(req.params.id)],
        )
      ).rows,
    ),
  );
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post(
    "/api/admin/events/:id/images",
    upload.single("image"),
    async (req, res) => {
      const id = uuid.parse(req.params.id);
      need(
        await one(db, "SELECT id FROM events WHERE id=$1", [id]),
        404,
        "Evento não encontrado.",
      );
      const url = await storeImage(req.file, cfg);
      res
        .status(201)
        .json(
          await one(
            db,
            "INSERT INTO images(id,event_id,url,position) VALUES($1,$2,$3,(SELECT COALESCE(max(position),0)+1 FROM images WHERE event_id=$2)) RETURNING *",
            [randomUUID(), id, url],
          ),
        );
    },
  );
  app.patch("/api/admin/images/:id", async (req, res) => {
    const b = z
      .object({ position: z.number().int().min(0).max(1000) })
      .parse(req.body);
    await db.query("UPDATE images SET position=$1 WHERE id=$2", [
      b.position,
      uuid.parse(req.params.id),
    ]);
    res.json({ ok: true });
  });
  app.delete("/api/admin/images/:id", async (req, res) => {
    await db.query("DELETE FROM images WHERE id=$1", [
      uuid.parse(req.params.id),
    ]);
    res.json({ ok: true });
  });
  app.post("/api/admin/logo", upload.single("image"), async (req, res) =>
    res.json({ url: await storeImage(req.file, cfg) }),
  );
  app.put("/api/admin/settings", async (req, res) => {
    const b = settingsSchema.parse(req.body);
    await db.query("UPDATE settings SET data=$1 WHERE id=1", [b]);
    res.json({ ok: true });
  });
  app.get("/api/admin/orders", async (req, res) => {
    const q = z
      .object({
        status: z
          .enum([
            "pending",
            "approved",
            "rejected",
            "cancelled",
            "refunded",
            "disputed",
          ])
          .optional(),
        search: z.string().max(100).default(""),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);
    res.json(
      (
        await db.query(
          "SELECT o.*,u.email FROM orders o JOIN users u ON u.id=o.user_id WHERE ($1::text IS NULL OR o.payment_status=$1) AND (u.email ILIKE $2 OR o.id::text ILIKE $2) ORDER BY o.created_at DESC LIMIT 100 OFFSET $3",
          [q.status || null, "%" + q.search + "%", (q.page - 1) * 100],
        )
      ).rows,
    );
  });
  app.get("/api/admin/orders/:id", async (req, res) =>
    res.json(await orderDetails(db, uuid.parse(req.params.id))),
  );
  app.post("/api/admin/reconcile", async (req, res) => {
    const id = req.body.order_id ? uuid.parse(req.body.order_id) : undefined;
    res.json(await reconcile(db, cfg, mp, id));
  });
  app.get("/api/admin/webhooks", async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 100",
        )
      ).rows,
    ),
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Rota não encontrada." }),
  );
  if (cfg.STORAGE_DRIVER === "local")
    app.use(
      "/uploads",
      express.static(path.resolve(cfg.UPLOAD_DIR), {
        dotfiles: "deny",
        immutable: true,
        maxAge: "1y",
      }),
    );
  app.use(express.static(path.join(root, "public"), { index: "index.html" }));
  app.use((err, req, res, next) => {
    let status = err.status || 500,
      message = err.message;
    if (err instanceof z.ZodError) {
      status = 400;
      message = err.issues
        .map(
          (i) => (i.path.join(".") ? i.path.join(".") + ": " : "") + i.message,
        )
        .join("; ");
    } else if (err.code === "23505") {
      status = 409;
      message = "Registro já existente. Confira e-mail, nome, código e lote.";
    } else if (err.code === "23503") {
      status = 400;
      message = "Referência não encontrada.";
    } else if (err.code === "LIMIT_FILE_SIZE") {
      status = 400;
      message = "Imagem acima do limite de 5 MB.";
    } else if (err instanceof multer.MulterError) {
      status = 400;
      message = "Upload inválido.";
    }
    if (status >= 500 && !(err instanceof HttpError)) {
      console.error(
        JSON.stringify({
          event: "request_error",
          code: err.code || "internal",
          path: req.path,
        }),
      );
      message = "Não foi possível concluir. Tente novamente em instantes.";
    }
    res.status(status).json({ error: message });
  });
  return app;
}
export async function catalog(db, admin) {
  const events = (
    await db.query(
      `SELECT p.*,c.name AS category FROM events p LEFT JOIN categories c ON c.id=p.category_id ${admin ? "" : "WHERE p.active AND p.status='published' AND p.starts_at>now() AND COALESCE(c.active,true)"} ORDER BY p.created_at,p.name`,
    )
  ).rows;
  const lots = (
    await db.query(
      `SELECT id,event_id,sku,lot_name,ticket_type,price_cents,stock,reserved,stock-reserved AS available,active,sales_start,sales_end,max_per_order FROM lots ${admin ? "" : "WHERE active"} ORDER BY lot_name,ticket_type`,
    )
  ).rows;
  const images = (await db.query("SELECT * FROM images ORDER BY position,id"))
    .rows;
  return events.map((p) => ({
    ...p,
    lots: lots.filter((v) => v.event_id === p.id),
    images: images.filter((i) => i.event_id === p.id),
  }));
}
