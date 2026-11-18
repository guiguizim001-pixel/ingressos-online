import { randomUUID } from "node:crypto";
import readline from "node:readline/promises";
import { readConfig } from "../src/config.js";
import { database, one } from "../src/db.js";
import { hashPassword } from "../src/auth.js";
import { email, password, short } from "../src/validation.js";
if (!process.stdin.isTTY)
  throw new Error("Execute este comando em um terminal interativo.");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
function secret(label) {
  return new Promise((resolve) => {
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let s = "";
    const handler = (b) => {
      for (const ch of b.toString()) {
        if (ch === "\u0003") process.exit(130);
        if (ch === "\r" || ch === "\n") {
          process.stdin.removeListener("data", handler);
          process.stdin.setRawMode(false);
          process.stdout.write("\n");
          process.stdin.pause();
          resolve(s);
          return;
        }
        if (ch === "\u007f" || ch === "\b") s = s.slice(0, -1);
        else if (ch >= " ") s += ch;
      }
    };
    process.stdin.on("data", handler);
  });
}
const cfg = readConfig(),
  db = database(cfg.DATABASE_URL);
try {
  const name = short.parse(await rl.question("Nome do administrador: ")),
    mail = email.parse(await rl.question("E-mail: "));
  rl.close();
  const pass = password.parse(
    await secret("Senha (mínimo 12 caracteres, entrada oculta): "),
  );
  if (pass !== (await secret("Repita a senha: ")))
    throw new Error("As senhas não coincidem.");
  const exists = await one(db, "SELECT id FROM users WHERE email=$1", [mail]);
  if (exists)
    throw new Error(
      "E-mail já cadastrado. Use outro e-mail para o administrador. Nenhuma conta foi promovida.",
    );
  await db.query(
    "INSERT INTO users(id,email,name,password_hash,role) VALUES($1,$2,$3,$4,'admin')",
    [randomUUID(), mail, name, await hashPassword(pass)],
  );
  console.log("Administrador criado. Entre pela opção Minha conta.");
} finally {
  rl.close();
  await db.end();
}
