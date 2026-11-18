import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { need } from "./validation.js";
export async function storeImage(file, cfg) {
  need(
    file && ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype),
    400,
    "Envie uma imagem JPEG, PNG ou WebP de até 5 MB.",
  );
  let bytes;
  try {
    const img = sharp(file.buffer, { limitInputPixels: 25000000 });
    const m = await img.metadata();
    need(
      ["jpeg", "png", "webp"].includes(m.format) && (!m.pages || m.pages === 1),
      400,
      "Formato de imagem inválido.",
    );
    bytes = await img
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    need(false, 400, "Imagem inválida ou grande demais.");
  }
  const key = randomUUID() + ".webp";
  if (cfg.STORAGE_DRIVER === "s3") {
    const client = new S3Client({
      region: cfg.S3_REGION,
      ...(cfg.S3_ENDPOINT ? { endpoint: cfg.S3_ENDPOINT } : {}),
      credentials: {
        accessKeyId: cfg.S3_ACCESS_KEY_ID,
        secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
      },
    });
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return cfg.S3_PUBLIC_URL.replace(/\/$/, "") + "/" + key;
  }
  await mkdir(cfg.UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(cfg.UPLOAD_DIR, key), bytes, { flag: "wx" });
  return "/uploads/" + key;
}
