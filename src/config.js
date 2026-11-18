import "dotenv/config";
import { z } from "zod";
const empty = z.string().default("");
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  MP_MODE: z.enum(["disabled", "test", "production"]).default("disabled"),
  MP_ACCESS_TOKEN: empty,
  MP_WEBHOOK_SECRET: empty,
  MP_COLLECTOR_ID: empty,
  RESERVATION_MINUTES: z.coerce.number().int().min(15).max(10080).default(60),
  SMTP_HOST: empty,
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.enum(["true", "false"]).default("false"),
  SMTP_USER: empty,
  SMTP_PASS: empty,
  MAIL_FROM: empty,
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("uploads"),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: empty,
  S3_BUCKET: empty,
  S3_ACCESS_KEY_ID: empty,
  S3_SECRET_ACCESS_KEY: empty,
  S3_PUBLIC_URL: empty,
  WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).default(60000),
});
export function readConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      "Configuração inválida ou ausente: " +
        [...new Set(parsed.error.issues.map((x) => x.path[0]))].join(", "),
    );
  const c = parsed.data;
  c.APP_URL = c.APP_URL.replace(/\/$/, "");
  if (
    c.MP_MODE !== "disabled" &&
    (!c.MP_ACCESS_TOKEN ||
      !c.MP_WEBHOOK_SECRET ||
      !/^\d+$/.test(c.MP_COLLECTOR_ID) ||
      !c.APP_URL.startsWith("https://"))
  )
    throw new Error(
      "Mercado Pago exige MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, MP_COLLECTOR_ID e APP_URL HTTPS.",
    );
  if (
    c.STORAGE_DRIVER === "s3" &&
    (!c.S3_BUCKET ||
      !c.S3_ACCESS_KEY_ID ||
      !c.S3_SECRET_ACCESS_KEY ||
      !c.S3_PUBLIC_URL.startsWith("https://"))
  )
    throw new Error("Armazenamento S3 incompleto.");
  if (
    c.NODE_ENV === "production" &&
    (!c.APP_URL.startsWith("https://") ||
      c.STORAGE_DRIVER !== "s3" ||
      !c.SMTP_HOST ||
      !c.MAIL_FROM ||
      c.MAIL_FROM.includes("example.test"))
  )
    throw new Error(
      "Produção exige HTTPS, armazenamento S3 e remetente SMTP real.",
    );
  return c;
}
