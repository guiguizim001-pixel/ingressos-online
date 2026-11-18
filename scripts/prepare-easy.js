// Uses only Node built-ins so it can run before dependencies are installed.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
async function run(command, args, logfile) {
  return new Promise((resolve, reject) => {
    const out = logfile ? createWriteStream(logfile, { flags: "w" }) : null;
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, NODE_ENV: "development" },
      stdio: logfile ? ["inherit", "pipe", "pipe"] : "inherit",
      windowsHide: false,
    });
    if (out) {
      child.stdout.on("data", (d) => {
        process.stdout.write(d);
        out.write(d);
      });
      child.stderr.on("data", (d) => {
        process.stderr.write(d);
        out.write(d);
      });
    }
    child.once("error", (e) => {
      out?.end();
      reject(e);
    });
    child.once("exit", (code) => {
      out?.end();
      code === 0
        ? resolve()
        : reject(Error("Etapa interrompida (código " + code + ")."));
    });
  });
}
try {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw Error(
      "Este iniciador foi preparado para Windows 10/11 de 64 bits (Intel ou AMD).",
    );
  if (!process.versions.node.startsWith("24."))
    throw Error(
      "A versão portátil do Node.js precisa ser da série 24. Abra ABRIR_INGRESSOS.bat.",
    );
  await mkdir(path.join(root, "logs"), { recursive: true });
  await mkdir(path.join(root, ".runtime"), { recursive: true });
  const fingerprint = createHash("sha256")
      .update(await readFile("package-lock.json"))
      .update(process.platform + process.arch + process.versions.node)
      .digest("hex"),
    marker = path.join(root, ".runtime", "dependencias.txt");
  let installed = "";
  try {
    installed = await readFile(marker, "utf8");
  } catch {}
  if (
    installed !== fingerprint ||
    !existsSync("node_modules/embedded-postgres/package.json") ||
    !existsSync("node_modules/express/package.json")
  ) {
    console.log(
      "\n[2/4] Preparando os componentes do site. A primeira vez pode demorar.",
    );
    console.log("Mantenha a internet conectada e esta janela aberta.");
    const npm = path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
    await run(
      process.execPath,
      [
        npm,
        "ci",
        "--include=dev",
        "--include=optional",
        "--no-audit",
        "--no-fund",
        "--registry=https://registry.npmjs.org",
      ],
      path.join(root, "logs", "instalacao.txt"),
    );
    await writeFile(marker, fingerprint);
  } else console.log("[2/4] Componentes já preparados.");
  await run(process.execPath, [path.join(root, "scripts", "easy-start.js")]);
} catch (e) {
  console.error("\nNão foi possível concluir: " + e.message);
  console.error("Confira a internet e abra ABRIR_INGRESSOS.bat novamente.");
  console.error(
    "Se continuar, envie uma foto da mensagem exibida. O registro da instalação fica em logs/instalacao.txt.",
  );
  process.exitCode = 1;
}
