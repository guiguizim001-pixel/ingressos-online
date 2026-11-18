import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import EmbeddedPostgres from "embedded-postgres";
import request from "supertest";
import sharp from "sharp";
import { database, one } from "../src/db.js";
import { migrate } from "../scripts/migrate.js";
import { seed } from "../scripts/seed.js";
import { readConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { hashPassword, hashToken } from "../src/auth.js";
import { checkTicket, customerTickets } from "../src/tickets.js";
import { createOrder, quote, expireReservations } from "../src/orders.js";
import {
  applyPayment,
  ensurePreference,
  preferenceBody,
  processEvents,
  reconcile,
  moneyCents,
} from "../src/payments.js";
let pg,
  db,
  cfg,
  app,
  tmp,
  customer,
  other,
  admin,
  mail = [];
const password = "Senha-de-teste-4321!";
async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
const signed = (id, secret) => {
  const ts = String(Date.now()),
    rid = randomUUID();
  return {
    "x-request-id": rid,
    "x-signature":
      "ts=" +
      ts +
      ",v1=" +
      createHmac("sha256", secret)
        .update(`id:${id};request-id:${rid};ts:${ts};`)
        .digest("hex"),
  };
};
async function login(who, application = app) {
  const agent = request.agent(application);
  const s = await agent.get("/api/session");
  const csrf = s.body.csrf;
  const r = await agent
    .post("/api/auth/login")
    .set("Origin", cfg.APP_URL)
    .set("X-CSRF-Token", csrf)
    .send({ email: who.email, password });
  assert.equal(r.status, 200);
  const session = await agent.get("/api/session");
  return {
    agent,
    csrf: session.body.csrf,
    post: (url, body, method = "post") =>
      agent[method](url)
        .set("Origin", cfg.APP_URL)
        .set("X-CSRF-Token", session.body.csrf)
        .send(body),
  };
}
async function fixture(stock = 5, price = 7990) {
  const product = randomUUID(),
    variant = randomUUID();
  await db.query(
    "INSERT INTO events(id,name,starts_at,ends_at,checkin_opens_at,venue,city,address,organizer,capacity,status) VALUES($1,'Evento de teste',now()+interval '30 days',now()+interval '31 days',now()-interval '1 day','Arena','Franca','Rua Teste','Equipe',200,'published')",
    [product],
  );
  await db.query(
    "INSERT INTO lots(id,event_id,sku,lot_name,ticket_type,price_cents,stock,sales_start,sales_end) VALUES($1,$2,$3,'1º lote','Pista',$4,$5,now()-interval '1 day',now()+interval '20 days')",
    [variant, product, randomUUID(), price, stock],
  );
  return {
    product,
    variant,
    input: {
      items: [
        { lot_id: variant, quantity: 1, attendees: ["Participante Teste"] },
      ],
      contact: { name: "Cliente Teste", phone: "11999999999" },
    },
  };
}
async function order(f, uid = customer.id) {
  return createOrder(db, cfg, uid, randomUUID(), f.input);
}
function payment(o, overrides = {}) {
  return {
    id: String(100000000 + Math.floor(Math.random() * 900000000)),
    external_reference: o.id,
    transaction_amount: o.total_cents / 100,
    transaction_amount_refunded: 0,
    currency_id: "BRL",
    collector_id: 123,
    live_mode: false,
    status: "approved",
    date_last_updated: new Date().toISOString(),
    ...overrides,
  };
}
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "loja-tests-"));
  const port = await freePort();
  const pw = randomBytes(20).toString("hex");
  pg = new EmbeddedPostgres({
    databaseDir: path.join(tmp, "pg"),
    user: "postgres",
    password: pw,
    port,
    persistent: false,
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
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("loja_test");
  cfg = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: `postgresql://postgres:${pw}@127.0.0.1:${port}/loja_test`,
    SESSION_SECRET: randomBytes(48).toString("hex"),
    APP_URL: "https://loja.test",
    MP_MODE: "test",
    MP_ACCESS_TOKEN: "fake-test-token",
    MP_WEBHOOK_SECRET: "webhook-test-secret",
    MP_COLLECTOR_ID: "123",
    UPLOAD_DIR: path.join(tmp, "uploads"),
  });
  db = database(cfg.DATABASE_URL);
  await migrate(db);
  await migrate(db);
  await seed(db, "test");
  const hash = await hashPassword(password);
  for (const role of ["customer", "other", "admin"]) {
    const u = { id: randomUUID(), email: role + "@example.test" };
    await db.query(
      "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5)",
      [u.id, u.email, role, hash, role === "admin" ? "admin" : "customer"],
    );
    if (role === "customer") customer = u;
    if (role === "other") other = u;
    if (role === "admin") admin = u;
  }
  app = createApp(db, cfg, { sendMail: async (m) => mail.push(m) });
});
after(async () => {
  await db?.end();
  await pg?.stop();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});
test("migrations e seed repetíveis, sem sobrescrever estoque", async () => {
  const n = await one(db, "SELECT count(*) AS n FROM events");
  const v = await one(db, "SELECT * FROM lots LIMIT 1");
  await db.query("UPDATE lots SET stock=3 WHERE id=$1", [v.id]);
  await seed(db, "test");
  assert.equal((await one(db, "SELECT count(*) AS n FROM events")).n, n.n);
  assert.equal(
    (await one(db, "SELECT stock FROM lots WHERE id=$1", [v.id])).stock,
    3,
  );
  await assert.rejects(() => seed(db, "production"));
});
test("cadastro, login, sessão regenerada e logout persistidos", async () => {
  const a = request.agent(app);
  let s = await a.get("/api/session");
  const oldCookie = s.headers["set-cookie"][0].split(";")[0];
  let r = await a
    .post("/api/auth/register")
    .set("Origin", cfg.APP_URL)
    .set("X-CSRF-Token", s.body.csrf)
    .send({ name: "Nova Pessoa", email: "  NOVA@example.test ", password });
  assert.equal(r.status, 201);
  assert.notEqual(r.headers["set-cookie"][0].split(";")[0], oldCookie);
  s = await a.get("/api/session");
  assert.equal(s.body.user.email, "nova@example.test");
  const cookie = r.headers["set-cookie"][0].split(";")[0];
  r = await a
    .post("/api/auth/logout")
    .set("Origin", cfg.APP_URL)
    .set("X-CSRF-Token", s.body.csrf)
    .send({});
  assert.equal(r.status, 200);
  assert.equal(
    (await request(app).get("/api/profile").set("Cookie", cookie)).status,
    401,
  );
});
test("senha inválida, e-mail único normalizado, sessão expirada", async () => {
  const s = await login(customer);
  let r = await s.post("/api/auth/register", {
    name: "Outra",
    email: "CUSTOMER@example.test",
    password,
  });
  assert.equal(r.status, 409);
  r = await s.post("/api/auth/login", {
    email: customer.email,
    password: "errada",
  });
  assert.equal(r.status, 401);
  await db.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE csrf=$1",
    [s.csrf],
  );
  assert.equal((await s.agent.get("/api/profile")).status, 401);
});
test("CSRF e origem obrigatórios nas alterações", async () => {
  const s = await login(customer);
  assert.equal(
    (await s.agent.patch("/api/profile").send({ name: "x", phone: "" })).status,
    403,
  );
  assert.equal(
    (
      await s.agent
        .patch("/api/profile")
        .set("Origin", "https://evil.test")
        .set("X-CSRF-Token", s.csrf)
        .send({ name: "x", phone: "" })
    ).status,
    403,
  );
});
test("cliente não promove sua conta e não acessa administração", async () => {
  const s = await login(customer);
  assert.equal((await s.agent.get("/api/admin/events")).status, 403);
  assert.equal(
    (
      await s.post(
        "/api/profile",
        { name: "Cliente", phone: "", role: "admin" },
        "patch",
      )
    ).status,
    200,
  );
  assert.equal((await s.agent.get("/api/profile")).body.role, "customer");
});
test("ingressos pertencem ao comprador; outro cliente não acessa QR", async () => {
  const f = await fixture(),
    o = await order(f);
  await applyPayment(db, cfg, payment(o));
  const s = await login(customer),
    t = await login(other);
  const r = await s.agent.get("/api/orders/" + o.id + "/tickets");
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.match(r.body[0].qr, /^data:image\/png;base64,/);
  assert.equal(
    (await t.agent.get("/api/orders/" + o.id + "/tickets")).status,
    404,
  );
});

test("recuperação uniforme, token de uso único e revogação de sessões", async () => {
  const s = await login(other);
  const a = await s.post("/api/auth/forgot", { email: other.email }),
    b = await s.post("/api/auth/forgot", { email: "missing@example.test" });
  assert.deepEqual(a.body, b.body);
  const token = mail.at(-1).text.match(/reset=([a-f0-9]+)/)[1];
  const r = await s.post("/api/auth/reset", { token, password });
  assert.equal(r.status, 200);
  assert.equal((await s.agent.get("/api/profile")).status, 401);
  const fresh = await login(other);
  assert.equal(
    (await fresh.post("/api/auth/reset", { token, password })).status,
    400,
  );
});
test("token de recuperação expirado é rejeitado", async () => {
  const s = await login(other);
  await s.post("/api/auth/forgot", { email: other.email });
  const token = mail.at(-1).text.match(/reset=([a-f0-9]+)/)[1];
  await db.query(
    "UPDATE password_tokens SET expires_at=now()-interval '1 second' WHERE id=$1",
    [hashToken(token)],
  );
  assert.equal(
    (await s.post("/api/auth/reset", { token, password })).status,
    400,
  );
});
test("preço, entrega física e estado enviados pelo cliente são ignorados", async () => {
  const f = await fixture();
  f.input.items[0].price_cents = 1;
  f.input.total_cents = 1;
  f.input.payment_status = "approved";
  f.input.delivery = { method: "shipping", price_cents: 999999 };
  const o = await order(f);
  assert.equal(o.total_cents, 7990);
  assert.equal(o.payment_status, "pending");
  assert.equal(
    (
      await one(db, "SELECT price_cents FROM order_items WHERE order_id=$1", [
        o.id,
      ])
    ).price_cents,
    7990,
  );
});
test("quantidade, lote e nomes de participantes são validados", async () => {
  const f = await fixture();
  for (const items of [
    [{ lot_id: f.variant, quantity: -1, attendees: ["A"] }],
    [{ lot_id: randomUUID(), quantity: 1, attendees: ["A"] }],
    [{ lot_id: f.variant, quantity: 2, attendees: ["A"] }],
    [{ lot_id: f.variant, quantity: 1, attendees: ["   "] }],
  ])
    await assert.rejects(() => quote(db, { ...f.input, items }));
});

test("entrega é digital, sem frete; desconto é calculado no servidor", async () => {
  await db.query(
    `UPDATE settings SET data=data || '{"discount_percent":10}'::jsonb`,
  );
  const f = await fixture(5, 10000),
    q = await quote(db, {
      ...f.input,
      delivery: { method: "shipping", cents: 1500 },
    });
  assert.equal(q.discount_cents, 1000);
  assert.equal(q.total_cents, 9000);
  assert.equal(q.shipping_cents, 0);
  assert.equal(q.delivery.method, "digital");
  await db.query(
    `UPDATE settings SET data=data || '{"discount_percent":0}'::jsonb`,
  );
});

test("idempotência concorrente e payload diferente não duplica pedido", async () => {
  const f = await fixture(),
    key = randomUUID();
  const [a, b] = await Promise.all([
    createOrder(db, cfg, customer.id, key, f.input),
    createOrder(db, cfg, customer.id, key, f.input),
  ]);
  assert.equal(a.id, b.id);
  assert.equal(
    (await one(db, "SELECT reserved FROM lots WHERE id=$1", [f.variant]))
      .reserved,
    1,
  );
  await assert.rejects(
    () =>
      createOrder(db, cfg, customer.id, key, {
        ...f.input,
        items: [{ lot_id: f.variant, quantity: 2, attendees: ["A", "B"] }],
      }),
    (e) => e.status === 409,
  );
});
test("duas compras concorrentes da última unidade: somente uma vence", async () => {
  const f = await fixture(1);
  const outcomes = await Promise.allSettled([order(f), order(f, other.id)]);
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (await one(db, "SELECT reserved FROM lots WHERE id=$1", [f.variant]))
      .reserved,
    1,
  );
});
test("cliente só lê o próprio pedido; reinício da aplicação mantém registros", async () => {
  const f = await fixture(),
    o = await order(f),
    s = await login(other);
  assert.equal((await s.agent.get("/api/orders/" + o.id)).status, 404);
  const restarted = createApp(db, cfg, { sendMail: async () => {} });
  const c = await login(customer, restarted);
  assert.equal(
    (await c.agent.get("/api/orders/" + o.id)).body.total_cents,
    7990,
  );
});
test("preferência idempotente e soma exata dos itens após desconto", async () => {
  const f = await fixture(),
    o = await order(f);
  let calls = 0;
  const mp = {
    call: async (path, opts) => {
      calls++;
      assert.equal(path, "/checkout/preferences");
      assert.equal(opts.body.external_reference, o.id);
      assert.equal(
        opts.body.items.reduce(
          (s, i) => s + Math.round(i.unit_price * 100) * i.quantity,
          0,
        ),
        o.total_cents,
      );
      return {
        id: "pref-" + o.id,
        external_reference: o.id,
        collector_id: 123,
        init_point: "https://www.mercadopago.com.br/checkout/test",
      };
    },
  };
  const a = await ensurePreference(db, cfg, mp, o.id),
    b = await ensurePreference(db, cfg, mp, o.id);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  const items = (
    await db.query("SELECT * FROM order_items WHERE order_id=$1", [o.id])
  ).rows;
  const discounted = { ...o, discount_cents: 799, shipping_cents: 1234 };
  const body = preferenceBody(discounted, items, cfg);
  assert.equal(
    body.items.reduce((s, i) => s + Math.round(i.unit_price * 100), 0),
    7990 - 799 + 1234,
  );
});
test("timeout de preferência não repete POST e recupera pela referência", async () => {
  const f = await fixture(),
    o = await order(f);
  let posts = 0;
  const uncertain = {
    call: async () => {
      posts++;
      throw new Error("timeout");
    },
  };
  assert.equal(
    (await ensurePreference(db, cfg, uncertain, o.id)).pending,
    true,
  );
  const recovery = {
    call: async (url) =>
      url.includes("/search?")
        ? {
            elements: [
              {
                id: "recovered-" + o.id,
                external_reference: o.id,
                collector_id: 123,
              },
            ],
          }
        : {
            id: "recovered-" + o.id,
            external_reference: o.id,
            collector_id: 123,
            init_point: "https://www.mercadopago.com.br/checkout/recovered",
          },
  };
  assert.ok((await ensurePreference(db, cfg, recovery, o.id)).checkout_url);
  assert.equal(posts, 1);
});
test("preferência incerta sem resultado permanece pendente sem nova cobrança", async () => {
  const f = await fixture(),
    o = await order(f);
  await db.query(
    "UPDATE payment_attempts SET state='creating' WHERE order_id=$1",
    [o.id],
  );
  const mp = {
    call: async (path, opts) => {
      assert.equal(opts, undefined);
      return { elements: [] };
    },
  };
  assert.equal((await ensurePreference(db, cfg, mp, o.id)).pending, true);
});
test("assinatura inválida não persiste evento; repetida não duplica", async () => {
  let r = await request(app)
    .post("/api/webhooks/mercadopago?data.id=98765")
    .send({ type: "payment" });
  assert.equal(r.status, 401);
  const headers = signed("98765", cfg.MP_WEBHOOK_SECRET);
  for (let i = 0; i < 2; i++) {
    r = await request(app)
      .post("/api/webhooks/mercadopago?data.id=98765")
      .set(headers)
      .send({ type: "payment", data: { id: "98765" } });
    assert.equal(r.status, 200);
  }
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM webhook_events WHERE payment_id='98765'",
      )
    ).n,
    1,
  );
  r = await request(app)
    .post("/api/webhooks/mercadopago?data.id=98765")
    .set(headers)
    .send({ type: "payment", data: { id: "other" } });
  assert.equal(r.status, 400);
});
test("aprovação consome estoque uma vez; evento antigo não reverte aprovação", async () => {
  const f = await fixture(3),
    o = await order(f),
    p = payment(o);
  await applyPayment(db, cfg, p);
  await applyPayment(db, cfg, p);
  await applyPayment(db, cfg, {
    ...p,
    status: "pending",
    date_last_updated: new Date(Date.now() - 60000).toISOString(),
  });
  assert.equal(
    (await one(db, "SELECT stock,reserved FROM lots WHERE id=$1", [f.variant]))
      .stock,
    2,
  );
  assert.equal(
    (await one(db, "SELECT payment_status FROM orders WHERE id=$1", [o.id]))
      .payment_status,
    "approved",
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM inventory_movements WHERE order_id=$1",
        [o.id],
      )
    ).n,
    1,
  );
});
test("pendente e recusado não consomem estoque nem aprovam pedido", async () => {
  const f = await fixture(3),
    o = await order(f),
    p = payment(o, { status: "pending" });
  await applyPayment(db, cfg, p);
  assert.equal(
    (await one(db, "SELECT stock FROM lots WHERE id=$1", [f.variant])).stock,
    3,
  );
  await applyPayment(db, cfg, {
    ...p,
    status: "rejected",
    date_last_updated: new Date(Date.now() + 1000).toISOString(),
  });
  assert.equal(
    (await one(db, "SELECT payment_status FROM orders WHERE id=$1", [o.id]))
      .payment_status,
    "rejected",
  );
});
test("valor, moeda, recebedor, ambiente ou referência incorretos são rejeitados", async () => {
  const f = await fixture(),
    o = await order(f);
  for (const wrong of [
    { transaction_amount: 0.01 },
    { currency_id: "USD" },
    { collector_id: 999 },
    { live_mode: true },
    { external_reference: randomUUID() },
  ])
    await assert.rejects(
      () => applyPayment(db, cfg, payment(o, wrong)),
      (e) => e.status === 422,
    );
  assert.equal(
    (await one(db, "SELECT payment_status FROM orders WHERE id=$1", [o.id]))
      .payment_status,
    "pending",
  );
});
test("reserva expira; aprovação tardia sem estoque bloqueia emissão", async () => {
  const f = await fixture(1),
    o = await order(f);
  await db.query(
    "UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [o.id],
  );
  await expireReservations(db);
  assert.equal(
    (await one(db, "SELECT reserved FROM lots WHERE id=$1", [f.variant]))
      .reserved,
    0,
  );
  await order(f, other.id);
  await applyPayment(db, cfg, payment(o));
  const updated = await one(db, "SELECT * FROM orders WHERE id=$1", [o.id]);
  assert.equal(updated.payment_status, "approved");
  assert.equal(updated.exception, "late_payment_no_stock");
  assert.equal(updated.fulfillment_status, "blocked");
  assert.equal(updated.stock_committed, false);
});
test("aprovação tardia com estoque livre libera o ingresso corretamente", async () => {
  const f = await fixture(1),
    o = await order(f);
  await db.query(
    "UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [o.id],
  );
  await expireReservations(db);
  await applyPayment(db, cfg, payment(o));
  assert.equal(
    (await one(db, "SELECT stock FROM lots WHERE id=$1", [f.variant])).stock,
    0,
  );
  assert.equal(
    (await one(db, "SELECT fulfillment_status FROM orders WHERE id=$1", [o.id]))
      .fulfillment_status,
    "ready",
  );
});
test("reembolso não repõe estoque; contestação bloqueia o ingresso", async () => {
  const f = await fixture(3),
    o = await order(f),
    p = payment(o);
  await applyPayment(db, cfg, p);
  await applyPayment(db, cfg, {
    ...p,
    status: "refunded",
    transaction_amount_refunded: 79.9,
    date_last_updated: new Date(Date.now() + 2000).toISOString(),
  });
  assert.equal(
    (await one(db, "SELECT stock FROM lots WHERE id=$1", [f.variant])).stock,
    2,
  );
  assert.equal(
    (await one(db, "SELECT fulfillment_status FROM orders WHERE id=$1", [o.id]))
      .fulfillment_status,
    "blocked",
  );
  const g = await fixture(),
    q = await order(g);
  await applyPayment(db, cfg, payment(q, { status: "charged_back" }));
  assert.equal(
    (await one(db, "SELECT payment_status FROM orders WHERE id=$1", [q.id]))
      .payment_status,
    "disputed",
  );
});
test("dois pagamentos aprovados não consomem duas vezes e geram ocorrência", async () => {
  const f = await fixture(3),
    o = await order(f);
  await applyPayment(db, cfg, payment(o));
  await applyPayment(db, cfg, payment(o));
  assert.equal(
    (await one(db, "SELECT stock FROM lots WHERE id=$1", [f.variant])).stock,
    2,
  );
  assert.equal(
    (await one(db, "SELECT exception FROM orders WHERE id=$1", [o.id]))
      .exception,
    "multiple_payments",
  );
});
test("fila retenta erro de rede e depois confirma pela API autenticada", async () => {
  await db.query("DELETE FROM webhook_events");
  const f = await fixture(),
    o = await order(f),
    p = payment(o);
  await db.query("INSERT INTO webhook_events(id,payment_id) VALUES($1,$2)", [
    "retry-case",
    p.id,
  ]);
  await processEvents(db, cfg, {
    call: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(
    (await one(db, "SELECT state FROM webhook_events WHERE id='retry-case'"))
      .state,
    "retry",
  );
  await db.query(
    "UPDATE webhook_events SET next_attempt_at=now() WHERE id='retry-case'",
  );
  await processEvents(db, cfg, {
    call: async (url) => {
      assert.equal(url, "/v1/payments/" + p.id);
      return p;
    },
  });
  assert.equal(
    (await one(db, "SELECT state FROM webhook_events WHERE id='retry-case'"))
      .state,
    "done",
  );
});
test("webhook com valor divergente entra em quarentena", async () => {
  const f = await fixture(),
    o = await order(f),
    p = payment(o, { transaction_amount: 1 });
  await db.query("INSERT INTO webhook_events(id,payment_id) VALUES($1,$2)", [
    "bad-payment",
    p.id,
  ]);
  await processEvents(db, cfg, { call: async () => p });
  assert.equal(
    (await one(db, "SELECT state FROM webhook_events WHERE id='bad-payment'"))
      .state,
    "quarantined",
  );
});
test("reconciliação recupera pagamento sem webhook", async () => {
  const f = await fixture(),
    o = await order(f),
    p = payment(o);
  const r = await reconcile(
    db,
    cfg,
    {
      call: async (url) =>
        url.includes("/search?") ? { results: [p], paging: { total: 1 } } : p,
    },
    o.id,
  );
  assert.equal(r.errors, 0);
  assert.equal(
    (await one(db, "SELECT payment_status FROM orders WHERE id=$1", [o.id]))
      .payment_status,
    "approved",
  );
});
test("admin não pode aprovar pagamento nem usar o antigo fluxo de envio", async () => {
  const s = await login(admin),
    f = await fixture(),
    o = await order(f);
  assert.equal(
    (
      await s.post(
        "/api/admin/orders/" + o.id,
        { payment_status: "approved", fulfillment_status: "shipped" },
        "patch",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await one(
        db,
        "SELECT count(*)::int AS n FROM tickets WHERE order_id=$1",
        [o.id],
      )
    ).n,
    0,
  );
});

test("ajuste de estoque não remove unidades reservadas; gera histórico", async () => {
  const f = await fixture(2);
  await order(f);
  const s = await login(admin);
  assert.equal(
    (
      await s.post("/api/admin/lots/" + f.variant + "/stock", {
        delta: -2,
        reason: "Ajuste",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await s.post("/api/admin/lots/" + f.variant + "/stock", {
        delta: 3,
        reason: "Entrada",
      })
    ).status,
    200,
  );
  assert.equal(
    (await s.agent.get("/api/admin/lots/" + f.variant + "/movements")).body
      .length,
    1,
  );
});
test("upload falso é rejeitado; imagem real é normalizada para WebP", async () => {
  const s = await login(admin),
    f = await fixture();
  let r = await s.agent
    .post("/api/admin/events/" + f.product + "/images")
    .set("Origin", cfg.APP_URL)
    .set("X-CSRF-Token", s.csrf)
    .attach("image", Buffer.from("<script>alert(1)</script>"), {
      filename: "fake.png",
      contentType: "image/png",
    });
  assert.equal(r.status, 400);
  const png = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "#888" },
  })
    .png()
    .toBuffer();
  r = await s.agent
    .post("/api/admin/events/" + f.product + "/images")
    .set("Origin", cfg.APP_URL)
    .set("X-CSRF-Token", s.csrf)
    .attach("image", png, { filename: "valid.png", contentType: "image/png" });
  assert.equal(r.status, 201);
  assert.match(r.body.url, /\.webp$/);
  assert.equal((await s.agent.get(r.body.url)).status, 200);
});
test("desativação, autorização de upload e cabeçalhos contra script", async () => {
  const s = await login(admin),
    f = await fixture();
  assert.equal(
    (await request(app).get("/")).headers["content-security-policy"].includes(
      "script-src 'self'",
    ),
    true,
  );
  assert.equal(
    (
      await s.post(
        "/api/admin/events/" + f.product,
        {
          ...(await one(db, "SELECT * FROM events WHERE id=$1", [f.product])),
          starts_at: new Date(Date.now() + 30 * 86400000).toISOString(),
          ends_at: new Date(Date.now() + 31 * 86400000).toISOString(),
          checkin_opens_at: new Date().toISOString(),
          rules: "Teste",
          name: "<script>alert(1)</script>",
          description: "<img src=x onerror=alert(1)>",
          active: false,
          demo: false,
          category_id: null,
        },
        "put",
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(app).get("/api/events")).body.some(
      (p) => p.id === f.product,
    ),
    false,
  );
  const c = await login(customer);
  assert.equal(
    (await c.post("/api/admin/events/" + f.product + "/images", {})).status,
    403,
  );
});
test("configuração desabilitada impede pedidos e dinheiro usa centavos exatos", async () => {
  const disabled = createApp(db, { ...cfg, MP_MODE: "disabled" }),
    s = await login(customer, disabled),
    f = await fixture();
  assert.equal((await s.post("/api/orders", f.input)).status, 503);
  assert.equal(moneyCents("79.90"), 7990);
  assert.throws(() => moneyCents("79.999"));
  assert.throws(() =>
    readConfig({ DATABASE_URL: "x", SESSION_SECRET: "short" }),
  );
});
test("limitação persistida de autenticação bloqueia após 12 tentativas", async () => {
  const a = request.agent(app),
    s = await a.get("/api/session");
  for (let i = 1; i <= 13; i++) {
    const r = await a
      .post("/api/auth/login")
      .set("Origin", cfg.APP_URL)
      .set("X-CSRF-Token", s.body.csrf)
      .send({ email: "rate-limit@example.test", password: "senha-incorreta" });
    assert.equal(r.status, i <= 12 ? 401 : 429);
  }
});
test("API completa de pedido retentada retorna mesmo pedido e preferência", async () => {
  const f = await fixture();
  let count = 0;
  const mp = {
    call: async (path, opts) => {
      assert.equal(path, "/checkout/preferences");
      count++;
      return {
        id: "api-pref-" + opts.body.external_reference,
        external_reference: opts.body.external_reference,
        collector_id: 123,
        init_point: "https://www.mercadopago.com.br/checkout/api",
      };
    },
  };
  const a = createApp(db, cfg, { mp }),
    s = await login(other, a),
    key = randomUUID();
  const go = () =>
    s.agent
      .post("/api/orders")
      .set("Origin", cfg.APP_URL)
      .set("X-CSRF-Token", s.csrf)
      .set("Idempotency-Key", key)
      .send({ ...f.input, total_cents: 1 });
  const first = await go(),
    second = await go();
  assert.equal(first.status, 201);
  assert.equal(second.body.order_id, first.body.order_id);
  assert.equal(count, 1);
});
test("configurações validam desconto, cor e URL de logotipo", async () => {
  const s = await login(admin),
    data = (await one(db, "SELECT data FROM settings WHERE id=1")).data;
  for (const bad of [
    { discount_percent: 99 },
    { accent: "javascript:bad" },
    { logo_url: "javascript:alert(1)" },
  ])
    assert.equal(
      (await s.post("/api/admin/settings", { ...data, ...bad }, "put")).status,
      400,
    );
});

test("alteração de preço depois da revisão exige novo cálculo antes de cobrar", async () => {
  const f = await fixture();
  const q = await quote(db, f.input);
  await db.query("UPDATE lots SET price_cents=8990 WHERE id=$1", [f.variant]);
  await assert.rejects(
    () =>
      createOrder(db, cfg, customer.id, randomUUID(), {
        ...f.input,
        expected_total_cents: q.total_cents,
      }),
    (e) => e.status === 409,
  );
  assert.equal(
    (await one(db, "SELECT reserved FROM lots WHERE id=$1", [f.variant]))
      .reserved,
    0,
  );
});
test("desconto em valores mínimos nunca envia linha zero ao provedor", async () => {
  const now = new Date();
  const o = {
    id: randomUUID(),
    subtotal_cents: 3,
    discount_cents: 1,
    shipping_cents: 0,
    created_at: now,
    expires_at: new Date(Date.now() + 60000),
  };
  const items = Array.from({ length: 3 }, () => ({
    lot_id: randomUUID(),
    name: "Peça",
    lot_name: "P",
    ticket_type: "Preto",
    quantity: 1,
    price_cents: 1,
  }));
  const body = preferenceBody(o, items, cfg);
  assert.ok(body.items.every((x) => x.unit_price > 0));
  assert.equal(
    body.items.reduce((s, x) => s + Math.round(x.unit_price * 100), 0),
    2,
  );
});

test("emissão nominal é atômica e idempotente; pendente não gera ingresso", async () => {
  const f = await fixture();
  f.input.items[0].quantity = 2;
  f.input.items[0].attendees = ["Ana Silva", "Bruno Souza"];
  const o = await order(f);
  assert.equal((await customerTickets(db, o.id, customer.id)).length, 0);
  const p = payment(o);
  await applyPayment(db, cfg, p);
  await applyPayment(db, cfg, p);
  const rows = await customerTickets(db, o.id, customer.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((t) => t.attendee_name).sort(), [
    "Ana Silva",
    "Bruno Souza",
  ]);
  assert.notEqual(rows[0].code, rows[1].code);
  assert.ok(rows.every((t) => t.usable));
});
test("entrada concorrente: apenas uma confirmação utiliza o ingresso", async () => {
  const f = await fixture(),
    o = await order(f);
  await applyPayment(db, cfg, payment(o));
  const [t] = await customerTickets(db, o.id, customer.id),
    body = { code: t.code, event_id: f.product };
  assert.equal((await checkTicket(db, body, admin.id)).consumed, false);
  const r = await Promise.allSettled([
    checkTicket(db, body, admin.id, true),
    checkTicket(db, body, admin.id, true),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.match(
    r.find((x) => x.status === "rejected").reason.message,
    /já utilizado/,
  );
  assert.equal(
    (await one(db, "SELECT status,checked_by FROM tickets WHERE id=$1", [t.id]))
      .checked_by,
    admin.id,
  );
});
test("controle de entrada requer administrador, evento correto e período aberto", async () => {
  const f = await fixture(),
    o = await order(f);
  await applyPayment(db, cfg, payment(o));
  const [t] = await customerTickets(db, o.id, customer.id),
    body = { code: t.code, event_id: f.product };
  const s = await login(customer);
  assert.equal((await s.post("/api/admin/checkin/verify", body)).status, 403);
  await assert.rejects(
    () => checkTicket(db, { ...body, event_id: randomUUID() }, admin.id),
    (e) => e.status === 409,
  );
  await db.query(
    "UPDATE events SET checkin_opens_at=now()+interval '1 day' WHERE id=$1",
    [f.product],
  );
  await assert.rejects(
    () => checkTicket(db, body, admin.id),
    (e) => e.status === 409,
  );
  await db.query(
    "UPDATE events SET checkin_opens_at=now()-interval '2 days',starts_at=now()-interval '1 day',ends_at=now()-interval '1 hour' WHERE id=$1",
    [f.product],
  );
  await assert.rejects(
    () => checkTicket(db, body, admin.id),
    (e) => e.status === 409,
  );
});
test("reembolso parcial revoga ingressos; aprovação repetida não os reativa", async () => {
  const f = await fixture(),
    o = await order(f),
    p = payment(o);
  await applyPayment(db, cfg, p);
  await applyPayment(db, cfg, {
    ...p,
    transaction_amount_refunded: 1,
    date_last_updated: new Date(Date.now() + 1000).toISOString(),
  });
  const [t] = await customerTickets(db, o.id, customer.id);
  assert.equal(t.status, "revoked");
  assert.equal(t.usable, false);
  await assert.rejects(
    () =>
      checkTicket(db, { code: t.code, event_id: f.product }, admin.id, true),
    (e) => e.status === 409,
  );
  await applyPayment(db, cfg, {
    ...p,
    date_last_updated: new Date(Date.now() + 2000).toISOString(),
  });
  assert.equal(
    (await customerTickets(db, o.id, customer.id))[0].status,
    "revoked",
  );
});
test("capacidade global impede sobrevendagem em lotes diferentes concorrentes", async () => {
  const f = await fixture(10),
    second = randomUUID();
  await db.query("UPDATE events SET capacity=1 WHERE id=$1", [f.product]);
  await db.query(
    "INSERT INTO lots(id,event_id,sku,lot_name,ticket_type,price_cents,stock,sales_start,sales_end) VALUES($1,$2,$3,'2º lote','VIP',9000,10,now()-interval '1 day',now()+interval '20 days')",
    [second, f.product, randomUUID()],
  );
  const r = await Promise.allSettled([
    order(f),
    createOrder(db, cfg, other.id, randomUUID(), {
      ...f.input,
      items: [{ lot_id: second, quantity: 1, attendees: ["Outra Pessoa"] }],
    }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
});
test("pagamento tardio não ultrapassa capacidade reservada em outro lote", async () => {
  const f = await fixture(10),
    o = await order(f),
    second = randomUUID();
  await db.query("UPDATE events SET capacity=1 WHERE id=$1", [f.product]);
  await db.query(
    "UPDATE orders SET expires_at=now()-interval '1 minute' WHERE id=$1",
    [o.id],
  );
  await expireReservations(db);
  await db.query(
    "INSERT INTO lots(id,event_id,sku,lot_name,ticket_type,price_cents,stock,sales_start,sales_end) VALUES($1,$2,$3,'2º lote','VIP',9000,10,now()-interval '1 day',now()+interval '20 days')",
    [second, f.product, randomUUID()],
  );
  await createOrder(db, cfg, other.id, randomUUID(), {
    ...f.input,
    items: [{ lot_id: second, quantity: 1, attendees: ["Outra Pessoa"] }],
  });
  await applyPayment(db, cfg, payment(o));
  assert.equal(
    (await one(db, "SELECT exception FROM orders WHERE id=$1", [o.id]))
      .exception,
    "event_capacity_exceeded",
  );
  assert.equal((await customerTickets(db, o.id, customer.id)).length, 0);
});
test("lotes respeitam limite por pedido, janela de vendas e encerramento do evento", async () => {
  const f = await fixture(20);
  f.input.items[0].quantity = 11;
  f.input.items[0].attendees = Array(11).fill("Pessoa");
  await assert.rejects(
    () => quote(db, f.input),
    (e) => e.status === 400,
  );
  f.input.items[0].quantity = 1;
  f.input.items[0].attendees = ["Pessoa"];
  await db.query(
    "UPDATE lots SET sales_start=now()+interval '1 day' WHERE id=$1",
    [f.variant],
  );
  await assert.rejects(
    () => quote(db, f.input),
    (e) => e.status === 400,
  );
  await db.query(
    "UPDATE lots SET sales_start=now()-interval '2 days',sales_end=now()-interval '1 day' WHERE id=$1",
    [f.variant],
  );
  await assert.rejects(
    () => quote(db, f.input),
    (e) => e.status === 400,
  );
  await db.query(
    "UPDATE lots SET sales_end=now()+interval '1 day' WHERE id=$1",
    [f.variant],
  );
  await db.query(
    "UPDATE events SET starts_at=now()-interval '1 hour' WHERE id=$1",
    [f.product],
  );
  await assert.rejects(
    () => quote(db, f.input),
    (e) => e.status === 400,
  );
});
test("evento cancelado bloqueia QR e aprovação posterior sem emitir ingresso", async () => {
  const f = await fixture(),
    o = await order(f);
  await db.query("UPDATE events SET status='cancelled' WHERE id=$1", [
    f.product,
  ]);
  await applyPayment(db, cfg, payment(o));
  assert.equal(
    (await one(db, "SELECT exception FROM orders WHERE id=$1", [o.id]))
      .exception,
    "event_unavailable",
  );
  assert.equal((await customerTickets(db, o.id, customer.id)).length, 0);
  const g = await fixture(),
    q = await order(g);
  await applyPayment(db, cfg, payment(q));
  await db.query("UPDATE events SET status='cancelled' WHERE id=$1", [
    g.product,
  ]);
  const [t] = await customerTickets(db, q.id, customer.id);
  assert.equal(t.usable, false);
  await assert.rejects(
    () =>
      checkTicket(db, { code: t.code, event_id: g.product }, admin.id, true),
    (e) => e.status === 409,
  );
});
test("pedido legado preservado não recebe ingresso na reconciliação", async () => {
  const f = await fixture(),
    o = await order(f);
  await db.query("UPDATE orders SET order_kind='legacy_physical' WHERE id=$1", [
    o.id,
  ]);
  await applyPayment(db, cfg, payment(o));
  assert.equal((await customerTickets(db, o.id, customer.id)).length, 0);
});
test("admin cadastra evento, lote e quantidade; capacidade não cai abaixo das reservas", async () => {
  const s = await login(admin),
    start = new Date(Date.now() + 86400000 * 10).toISOString(),
    b = {
      name: "Evento cadastrado",
      description: "Teste",
      category_id: null,
      active: true,
      demo: true,
      starts_at: start,
      ends_at: new Date(Date.now() + 86400000 * 11).toISOString(),
      checkin_opens_at: new Date().toISOString(),
      venue: "Arena",
      city: "Franca",
      address: "Rua 1",
      organizer: "Equipe",
      rules: "Regras",
      capacity: 2,
      status: "published",
    };
  const e = await s.post("/api/admin/events", b);
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const l = await s.post("/api/admin/events/" + e.body.id + "/lots", {
    sku: randomUUID(),
    lot_name: "Lote 1",
    ticket_type: "Pista",
    price_cents: 5000,
    active: true,
    sales_start: new Date(Date.now() - 86400000).toISOString(),
    sales_end: start,
    max_per_order: 10,
  });
  assert.equal(l.status, 201, JSON.stringify(l.body));
  assert.equal(
    (
      await s.post("/api/admin/lots/" + l.body.id + "/stock", {
        delta: 2,
        reason: "Abertura",
      })
    ).status,
    200,
  );
  await createOrder(db, cfg, customer.id, randomUUID(), {
    contact: { name: "Teste", phone: "11999999999" },
    items: [{ lot_id: l.body.id, quantity: 2, attendees: ["A", "B"] }],
  });
  assert.equal(
    (
      await s.post(
        "/api/admin/events/" + e.body.id,
        { ...b, capacity: 1 },
        "put",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await s.post(
        "/api/admin/events/" + e.body.id,
        { ...b, ends_at: b.checkin_opens_at },
        "put",
      )
    ).status,
    400,
  );
});
test("migração da versão 1 preserva cadastro e pedido; retira roupas do catálogo", async () => {
  const c = await db.connect(),
    schema = "upgrade_" + randomBytes(6).toString("hex");
  try {
    await c.query("CREATE SCHEMA " + schema);
    await c.query("SET search_path TO " + schema);
    await c.query(
      await readFile(
        new URL("../migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    const uid = randomUUID(),
      eid = randomUUID(),
      lid = randomUUID(),
      oid = randomUUID();
    await c.query(
      "INSERT INTO users(id,email,name,password_hash) VALUES($1,'old@example.test','Cliente antigo','hash-preservado')",
      [uid],
    );
    await c.query(
      "INSERT INTO products(id,name) VALUES($1,'Camiseta antiga')",
      [eid],
    );
    await c.query(
      "INSERT INTO variants(id,product_id,sku,size,color,price_cents,stock) VALUES($1,$2,'ANTIGO','M','Preto',5000,3)",
      [lid, eid],
    );
    await c.query(
      "INSERT INTO orders(id,user_id,idem_key,request_hash,subtotal_cents,shipping_cents,total_cents,delivery,contact,expires_at) VALUES($1,$2,'antigo','hash',5000,0,5000,'{}','{}',now())",
      [oid, uid],
    );
    await c.query(
      await readFile(
        new URL("../migrations/002_tickets.sql", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(
      (await one(c, "SELECT password_hash FROM users WHERE id=$1", [uid]))
        .password_hash,
      "hash-preservado",
    );
    const e = await one(c, "SELECT * FROM events WHERE id=$1", [eid]);
    assert.equal(e.active, false);
    assert.equal(e.status, "draft");
    assert.equal(
      (await one(c, "SELECT order_kind FROM orders WHERE id=$1", [oid]))
        .order_kind,
      "legacy_physical",
    );
    assert.equal(
      (await one(c, "SELECT stock FROM lots WHERE id=$1", [lid])).stock,
      3,
    );
  } finally {
    await c.query("SET search_path TO public");
    await c.query("DROP SCHEMA " + schema + " CASCADE");
    c.release();
  }
});
test("API de check-in verifica, confirma uma vez e lista participante utilizado", async () => {
  const f = await fixture(),
    o = await order(f);
  await applyPayment(db, cfg, payment(o));
  const [t] = await customerTickets(db, o.id, customer.id),
    s = await login(admin),
    b = { code: t.code, event_id: f.product };
  assert.equal((await s.post("/api/admin/checkin/verify", b)).status, 200);
  assert.equal((await s.post("/api/admin/checkin/confirm", b)).status, 200);
  assert.equal((await s.post("/api/admin/checkin/confirm", b)).status, 409);
  const r = await s.agent.get("/api/admin/events/" + f.product + "/attendees");
  assert.equal(r.status, 200);
  assert.equal(r.body[0].status, "used");
  assert.equal(r.body[0].code, undefined);
});
