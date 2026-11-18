import {
  randomBytes,
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import nodemailer from "nodemailer";
import { one, tx } from "./db.js";
import { email, password, short, need } from "./validation.js";
export const hashToken = (v) => createHash("sha256").update(v).digest("hex");
export const hashPassword = (p) =>
  argon2.hash(p, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
const random = () => randomBytes(32).toString("hex");
const safeEq = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function auth(app, db, cfg, { sendMail } = {}) {
  const cookie = cfg.NODE_ENV === "production" ? "__Host-loja" : "loja";
  const opts = {
    httpOnly: true,
    secure: cfg.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400000,
  };
  const sign = (x) =>
    createHmac("sha256", cfg.SESSION_SECRET).update(x).digest("hex");
  async function session(req, res, uid = null) {
    const token = random(),
      csrf = random(),
      id = hashToken(token);
    await tx(db, async (c) => {
      if (req.session)
        await c.query("DELETE FROM sessions WHERE id=$1", [req.session.id]);
      await c.query(
        "INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",
        [id, uid, csrf],
      );
    });
    res.cookie(cookie, token + "." + sign(token), opts);
    req.session = { id, user_id: uid, csrf };
    return csrf;
  }
  app.use("/api", async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const val = req.cookies[cookie];
    if (typeof val === "string") {
      const [t, s] = val.split(".");
      if (t && s && safeEq(sign(t), s)) {
        req.session = await one(
          db,
          "SELECT * FROM sessions WHERE id=$1 AND expires_at>now()",
          [hashToken(t)],
        );
        if (req.session?.user_id)
          req.user = await one(
            db,
            "SELECT id,email,name,phone,role FROM users WHERE id=$1",
            [req.session.user_id],
          );
      }
    }
    next();
  });
  app.get("/api/session", async (req, res) => {
    if (!req.session) await session(req, res);
    res.json({ user: req.user || null, csrf: req.session.csrf });
  });
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    need(
      req.get("origin") === new URL(cfg.APP_URL).origin,
      403,
      "Origem não autorizada.",
    );
    need(
      req.session && safeEq(req.get("x-csrf-token"), req.session.csrf),
      403,
      "Sessão expirada. Atualize a página.",
    );
    next();
  });
  async function limit(req, value) {
    const key = hashToken(value);
    const row = await one(
      db,
      "INSERT INTO auth_limits(key,attempts,until_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_limits.until_at<now() THEN 1 ELSE auth_limits.attempts+1 END,until_at=CASE WHEN auth_limits.until_at<now() THEN now()+interval '15 minutes' ELSE auth_limits.until_at END RETURNING attempts",
      [key],
    );
    need(row.attempts <= 12, 429, "Muitas tentativas. Aguarde 15 minutos.");
  }
  app.post("/api/auth/register", async (req, res) => {
    const b = z.object({ name: short, email, password }).parse(req.body);
    await limit(req, "register:" + req.ip);
    const id = randomUUID();
    const h = await hashPassword(b.password);
    await db.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)",
      [id, b.name, b.email, h],
    );
    await session(req, res, id);
    res.status(201).json({ ok: true });
  });
  const dummyHash = hashPassword(random());
  app.post("/api/auth/login", async (req, res) => {
    const b = z
      .object({ email, password: z.string().min(1).max(128) })
      .parse(req.body);
    await limit(req, "login:" + b.email);
    const u = await one(db, "SELECT * FROM users WHERE email=$1", [b.email]);
    const valid = await argon2.verify(
      u?.password_hash || (await dummyHash),
      b.password,
    );
    need(u && valid, 401, "E-mail ou senha incorretos.");
    await session(req, res, u.id);
    res.json({ ok: true });
  });
  app.post("/api/auth/logout", async (req, res) => {
    if (req.session)
      await db.query("DELETE FROM sessions WHERE id=$1", [req.session.id]);
    res.clearCookie(cookie, opts);
    res.json({ ok: true });
  });
  const transport =
    sendMail ||
    ((mail) =>
      nodemailer
        .createTransport({
          host: cfg.SMTP_HOST,
          port: cfg.SMTP_PORT,
          secure: cfg.SMTP_SECURE === "true",
          ...(cfg.SMTP_USER
            ? { auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } }
            : {}),
        })
        .sendMail(mail));
  app.post("/api/auth/forgot", async (req, res) => {
    const b = z.object({ email }).parse(req.body);
    await limit(req, "forgot:" + req.ip);
    await limit(req, "forgot-email:" + b.email);
    const u = await one(db, "SELECT id FROM users WHERE email=$1", [b.email]);
    if (u) {
      const token = random();
      await db.query(
        "INSERT INTO password_tokens(id,user_id,expires_at) VALUES($1,$2,now()+interval '30 minutes')",
        [hashToken(token), u.id],
      );
      try {
        await transport({
          from: cfg.MAIL_FROM,
          to: b.email,
          subject: "Redefinir sua senha — Ingressos",
          text: `Abra este link em até 30 minutos: ${cfg.APP_URL}/#reset=${token}\nSe você não solicitou, ignore esta mensagem.`,
        });
      } catch {
        console.error(JSON.stringify({ event: "password_email_failed" }));
      }
    }
    res.json({
      message:
        "Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.",
    });
  });
  app.post("/api/auth/reset", async (req, res) => {
    const b = z
      .object({ token: z.string().regex(/^[a-f0-9]{64}$/), password })
      .parse(req.body);
    await limit(req, "reset:" + req.ip);
    const h = await hashPassword(b.password);
    await tx(db, async (c) => {
      const t = await one(
        c,
        "SELECT * FROM password_tokens WHERE id=$1 AND expires_at>now() AND used_at IS NULL FOR UPDATE",
        [hashToken(b.token)],
      );
      need(t, 400, "Link inválido ou expirado. Solicite outro.");
      await c.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
        h,
        t.user_id,
      ]);
      await c.query(
        "UPDATE password_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL",
        [t.user_id],
      );
      await c.query("DELETE FROM sessions WHERE user_id=$1", [t.user_id]);
    });
    res.clearCookie(cookie, opts);
    res.json({ ok: true });
  });
  return { session };
}
export function requireUser(req, res, next) {
  need(req.user, 401, "Entre na sua conta para continuar.");
  next();
}
export function requireAdmin(req, res, next) {
  need(req.user?.role === "admin", 403, "Acesso restrito ao administrador.");
  next();
}
