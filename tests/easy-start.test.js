import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { startEasy } from "../scripts/easy-start.js";
import { one } from "../src/db.js";

test("modo fácil inicia tudo, cria admin, recupera senha e preserva dados ao reabrir", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ingressos-facil-"));
  let app;
  try {
    app = await startEasy({
      dataDir: dir,
      port: 0,
      launchBrowser: false,
      log: () => {},
    });
    const r = await fetch(app.url + "/health");
    assert.equal(r.status, 200);
    const html = await fetch(app.url + "/iniciar").then((r) => r.text());
    assert.match(html, /Crie seu acesso de administrador/);
    assert.equal((await fetch(app.url + "/_easy/api/status")).status, 403);
    const status = await fetch(app.url + "/_easy/api/status", {
      headers: { "x-local-key": app.token },
    }).then((r) => r.json());
    assert.equal(status.needs_admin, true);
    const post = (route, body, origin = app.url) =>
      fetch(app.url + "/_easy/api/" + route, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-local-key": app.token,
          Origin: origin,
        },
        body: JSON.stringify(body),
      });
    const owner = {
      name: "Admin local",
      email: "local@example.test",
      password: "Senha-local-12345!",
      confirm: "Senha-local-12345!",
    };
    assert.equal(
      (await post("owner", owner, "https://outra-origem.test")).status,
      403,
    );
    assert.equal(
      (await post("owner", { ...owner, confirm: "outra" })).status,
      400,
    );
    const attempts = await Promise.all([
      post("owner", owner),
      post("owner", owner),
    ]);
    assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
    assert.equal(
      (
        await one(
          app.db,
          "SELECT count(*)::int AS n FROM users WHERE role='admin'",
        )
      ).n,
      1,
    );
    const agent = request.agent(app.server);
    let session = (
      await agent.get("/api/session").set("Host", new URL(app.url).host)
    ).body;
    const login = await agent
      .post("/api/auth/login")
      .set("Origin", app.url)
      .set("Host", new URL(app.url).host)
      .set("X-CSRF-Token", session.csrf)
      .send({ email: owner.email, password: owner.password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    // Actual HTTP server is bound to loopback; test agent must keep the canonical host.
    session = (
      await agent.get("/api/session").set("Host", new URL(app.url).host)
    ).body;
    const forgot = await agent
      .post("/api/auth/forgot")
      .set("Host", new URL(app.url).host)
      .set("Origin", app.url)
      .set("X-CSRF-Token", session.csrf)
      .send({ email: owner.email });
    assert.equal(forgot.status, 200);
    const mail = await fetch(app.url + "/_easy/api/mail", {
      headers: { "x-local-key": app.token },
    }).then((r) => r.json());
    assert.equal(mail.length, 1);
    assert.match(mail[0].text, /#reset=[a-f0-9]{64}/);
    const store = await fetch(app.url + "/api/store").then((r) => r.json());
    assert.equal(store.local_easy, true);
    assert.equal(store.payment.enabled, false);
    const oldToken = app.token,
      config = await readFile(path.join(dir, "config.json"), "utf8");
    await assert.rejects(
      () =>
        startEasy({
          dataDir: dir,
          port: 0,
          launchBrowser: false,
          log: () => {},
        }),
      /já está aberto/,
    );
    await app.stop();
    app = null;
    app = await startEasy({
      dataDir: dir,
      port: 0,
      launchBrowser: false,
      log: () => {},
    });
    assert.equal(await readFile(path.join(dir, "config.json"), "utf8"), config);
    assert.equal(
      (
        await one(
          app.db,
          "SELECT count(*)::int AS n FROM users WHERE role='admin'",
        )
      ).n,
      1,
    );
    assert.equal(
      (
        await fetch(app.url + "/_easy/api/status", {
          headers: { "x-local-key": oldToken },
        })
      ).status,
      403,
    );
    const state = await fetch(app.url + "/_easy/api/status", {
      headers: { "x-local-key": app.token },
    }).then((r) => r.json());
    assert.equal(state.needs_admin, false);
    assert.equal(
      (
        await fetch(app.url + "/_easy/api/stop", {
          method: "POST",
          headers: { Origin: app.url, "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      403,
    );
  } finally {
    await app?.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
