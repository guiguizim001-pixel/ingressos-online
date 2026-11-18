import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import net from "node:net";
import express from "express";
import helmet from "helmet";
import EmbeddedPostgres from "embedded-postgres";
import { z } from "zod";
import { database, one, tx } from "../src/db.js";
import { readConfig } from "../src/config.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth.js";
import { short, email, password, need, HttpError } from "../src/validation.js";
import { migrate } from "./migrate.js";
import { seed } from "./seed.js";
import { reconcile, provider } from "../src/payments.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const secret = () => randomBytes(32).toString("hex");
const same = (a, b) =>
  typeof a === "string" &&
  /^[a-f0-9]{64}$/.test(a) &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const ownerSchema = z
  .object({ name: short, email, password, confirm: z.string() })
  .refine((x) => x.password === x.confirm, "As senhas não coincidem.");
export function mountEasyPanel(app, { db, cfg, token, mails, onStop }) {
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use(express.json({ limit: "30kb" }));
  app.get("/iniciar", (req, res) =>
    res.sendFile(path.join(root, "local-panel/index.html")),
  );
  app.use(
    "/_easy/assets",
    express.static(path.join(root, "local-panel"), { index: false }),
  );
  app.use("/_easy/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    need(
      same(req.get("x-local-key"), token),
      403,
      "Abra o arquivo ABRIR_INGRESSOS.bat para acessar o painel inicial.",
    );
    if (req.method !== "GET")
      need(req.get("origin") === cfg.APP_URL, 403, "Origem não autorizada.");
    next();
  });
  app.get("/_easy/api/status", async (req, res) =>
    res.json({
      needs_admin: !(await one(
        db,
        "SELECT id FROM users WHERE role='admin' LIMIT 1",
      )),
      mode: "local",
      payment: "disabled",
    }),
  );
  app.post("/_easy/api/owner", async (req, res) => {
    const b = ownerSchema.parse(req.body),
      hash = await hashPassword(b.password);
    await tx(db, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(987319)");
      need(
        !(await one(c, "SELECT id FROM users WHERE role='admin' LIMIT 1")),
        409,
        "O administrador já foi criado. Entre com sua conta.",
      );
      await c.query(
        "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
        [randomUUID(), b.email, b.name, hash],
      );
    });
    res.status(201).json({ ok: true });
  });
  app.get("/_easy/api/mail", (req, res) => res.json(mails));
  app.post("/_easy/api/stop", (req, res) => {
    res.json({ ok: true });
    setTimeout(() => onStop(), 250);
  });
}
export function openBrowser(url) {
  if (process.env.EASY_NO_BROWSER === "1") return;
  // URL is generated here from the bound loopback port and a random hex token.
  const child =
    process.platform === "win32"
      ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
          detached: true,
          stdio: "ignore",
        });
  child.on("error", () =>
    console.log("Abra no navegador o endereço exibido nesta janela."),
  );
  child.unref();
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function listen(server, preferred) {
  for (let n = 0; n < 20; n++) {
    try {
      await new Promise((resolve, reject) => {
        const error = (e) => {
          server.off("listening", listening);
          reject(e);
        };
        const listening = () => {
          server.off("error", error);
          resolve();
        };
        server.once("error", error);
        server.once("listening", listening);
        server.listen(preferred ? preferred + n : 0, "127.0.0.1");
      });
      return server.address().port;
    } catch (e) {
      if (e.code !== "EADDRINUSE") throw e;
    }
  }
  throw Error(
    "Não há porta local livre. Feche outra execução do site e tente novamente.",
  );
}
export async function startEasy({
  dataDir = path.join(root, "dados-locais"),
  port = 3050,
  launchBrowser = true,
  log = console.log,
} = {}) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = path.join(dataDir, "aberto.json");
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let old;
    try {
      old = JSON.parse(await readFile(lockPath, "utf8"));
    } catch {
      throw Error(
        "Uma abertura anterior não terminou. Feche a outra janela; se necessário reinicie o computador. Não apague seus dados.",
      );
    }
    let alive = true;
    try {
      process.kill(old.pid, 0);
    } catch (e) {
      if (e.code === "ESRCH") alive = false;
    }
    if (alive)
      throw Error(
        "O programa já está aberto ou iniciando nesta pasta. Volte à janela anterior.",
      );
    await unlink(lockPath);
    lock = await open(lockPath, "wx", 0o600);
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid }));
  await lock.close();
  let pg,
    db,
    server,
    timer,
    running = Promise.resolve(),
    stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    if (server?.listening) {
      server.closeIdleConnections();
      await new Promise((r) => server.close(r));
    }
    await running.catch(() => {});
    if (db) await db.end();
    if (pg) {
      if (pg.process?.exitCode !== null && pg.process?.exitCode !== undefined)
        pg.process = undefined;
      // pg_ctl performs a clean shutdown on Windows; the package fallback uses taskkill.
      if (process.platform === "win32" && pg.process) {
        const { pg_ctl } = await import("@embedded-postgres/windows-x64");
        await new Promise((resolve, reject) => {
          const child = spawn(
            pg_ctl,
            [
              "stop",
              "-D",
              path.join(dataDir, "banco"),
              "-m",
              "fast",
              "-w",
              "-t",
              "30",
            ],
            { windowsHide: true, stdio: "ignore" },
          );
          child.once("error", reject);
          child.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(
                  Error(
                    "Não foi possível encerrar o banco com segurança. Aguarde e tente Ctrl+C.",
                  ),
                ),
          );
        });
        pg.process = undefined;
      } else await pg.stop();
    }
    await unlink(lockPath).catch(() => {});
    log("Site encerrado. Seus dados foram mantidos.");
  };
  try {
    log("[3/4] Preparando seu banco de dados local...");
    const configPath = path.join(dataDir, "config.json");
    let saved;
    if (existsSync(configPath))
      saved = JSON.parse(await readFile(configPath, "utf8"));
    else {
      if (existsSync(path.join(dataDir, "banco", "PG_VERSION")))
        throw Error(
          "O arquivo dados-locais/config.json está ausente. Restaure-o do seu backup para acessar o banco existente.",
        );
      saved = {
        version: 1,
        password: secret(),
        session: secret(),
        seeded: false,
      };
      await writeFile(configPath, JSON.stringify(saved, null, 2), {
        flag: "wx",
        mode: 0o600,
      });
    }
    z.object({
      version: z.literal(1),
      password: z.string().regex(/^[a-f0-9]{64}$/),
      session: z.string().regex(/^[a-f0-9]{64}$/),
      seeded: z.boolean(),
    }).parse(saved);
    const dbPort = await freePort();
    pg = new EmbeddedPostgres({
      databaseDir: path.join(dataDir, "banco"),
      user: "ingressos",
      password: saved.password,
      port: dbPort,
      persistent: true,
      authMethod: "scram-sha-256",
      postgresFlags: [
        "-c",
        "listen_addresses=127.0.0.1",
        "-c",
        "unix_socket_directories=",
      ],
      onLog: () => {},
      onError: () => {},
    });
    if (!existsSync(path.join(dataDir, "banco", "PG_VERSION")))
      await pg.initialise();
    await pg.start();
    const bootstrap = database(
      `postgresql://ingressos:${saved.password}@127.0.0.1:${dbPort}/postgres`,
    );
    try {
      if (
        !(await one(
          bootstrap,
          "SELECT 1 FROM pg_database WHERE datname='ingressos'",
        ))
      )
        await bootstrap.query("CREATE DATABASE ingressos");
    } finally {
      await bootstrap.end();
    }
    db = database(
      `postgresql://ingressos:${saved.password}@127.0.0.1:${dbPort}/ingressos`,
    );
    await migrate(db);
    if (!saved.seeded) {
      await seed(db, "development");
      saved.seeded = true;
      await writeFile(configPath, JSON.stringify(saved, null, 2), {
        mode: 0o600,
      });
    }
    let ready;
    server = createServer((req, res) => {
      if (ready) return ready(req, res);
      res.writeHead(503, { "Content-Type": "text/plain;charset=utf-8" });
      res.end("Preparando o site. Atualize em instantes.");
    });
    const webPort = await listen(server, port),
      url = `http://127.0.0.1:${webPort}`;
    const cfg = readConfig({
      NODE_ENV: "development",
      PORT: webPort,
      APP_URL: url,
      DATABASE_URL: `postgresql://ingressos:${saved.password}@127.0.0.1:${dbPort}/ingressos`,
      SESSION_SECRET: saved.session,
      MP_MODE: "disabled",
      UPLOAD_DIR: path.join(dataDir, "imagens"),
      WORKER_INTERVAL_MS: 60000,
    });
    cfg.LOCAL_EASY = true;
    const token = secret(),
      mails = [],
      router = express();
    router.use((req, res, next) => {
      if (req.get("host") !== `127.0.0.1:${webPort}`)
        return res
          .status(403)
          .send("Use o endereço local aberto pelo programa.");
      next();
    });
    mountEasyPanel(router, {
      db,
      cfg,
      token,
      mails,
      onStop: () => stop().catch((e) => log(e.message)),
    });
    router.use(
      createApp(db, cfg, {
        sendMail: async (m) => {
          mails.unshift({
            to: m.to,
            subject: m.subject,
            text: m.text,
            created_at: new Date().toISOString(),
          });
          mails.splice(20);
        },
      }),
    );
    router.use((err, req, res, next) =>
      res
        .status(err instanceof z.ZodError ? 400 : err.status || 500)
        .json({
          error:
            err instanceof z.ZodError
              ? err.issues.map((i) => i.message).join("; ")
              : err instanceof HttpError
                ? err.message
                : err.code === "23505"
                  ? "E-mail já cadastrado. Escolha outro e-mail."
                  : "Não foi possível concluir. Confira os dados e tente novamente.",
        }),
    );
    ready = router;
    const work = () => {
      running = running
        .then(() => (stopping ? undefined : reconcile(db, cfg, provider(cfg))))
        .catch(() =>
          log(
            "Não foi possível atualizar as reservas agora. Uma nova tentativa será feita.",
          ),
        );
    };
    work();
    timer = setInterval(work, 60000);
    const startUrl = url + "/iniciar#" + token;
    await writeFile(lockPath, JSON.stringify({pid:process.pid,url:startUrl}), {mode:0o600});
    log("[4/4] Pronto! O site está aberto no seu navegador.");
    log("Painel inicial: " + startUrl);
    log("Não compartilhe o endereço completo do painel inicial.");
    log(
      "Mantenha esta janela aberta. Para encerrar, use o botão no painel ou Ctrl+C.",
    );
    if (launchBrowser) openBrowser(startUrl);
    return { url, startUrl, token, cfg, db, server, stop };
  } catch (e) {
    await stop().catch(() => {});
    throw e;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  let instance;
  try {
    instance = await startEasy();
    for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"])
      process.on(s, () =>
        instance
          .stop()
          .then(() => process.exit(0))
          .catch((e) => {
            console.error(e.message);
            process.exitCode = 1;
          }),
      );
  } catch (e) {
    console.error(
      "\nNão foi possível abrir o site. " +
        (e?.message || "Falha ao iniciar o banco local."),
    );
    console.error(
      "Feche outra execução, confira a conexão e tente novamente. Se continuar, envie uma foto desta janela.",
    );
    process.exitCode = 1;
  }
}
