import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
try {
  await writeFile(
    ".env",
    (await readFile(".env.example", "utf8")).replace(
      "SESSION_SECRET=",
      "SESSION_SECRET=" + randomBytes(48).toString("hex"),
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    ".env criado com segredo aleatório. Agora inicie o banco, rode migrations e seed.",
  );
} catch (e) {
  if (e.code === "EEXIST") console.log(".env já existe; nada foi alterado.");
  else throw e;
}
