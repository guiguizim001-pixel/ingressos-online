const $ = (s) => document.querySelector(s);
let key = location.hash.slice(1);
if (/^[a-f0-9]{64}$/.test(key)) {
  sessionStorage.setItem("ingressos-local-key", key);
  history.replaceState(null, "", "/iniciar");
} else key = sessionStorage.getItem("ingressos-local-key") || "";
async function local(url, body) {
  const r = await fetch("/_easy/api/" + url, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-local-key": key },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const b = await r.json();
  if (!r.ok) throw Error(b.error || "Não foi possível concluir.");
  return b;
}
function message(text, error = false) {
  $("#status").textContent = text;
  $("#status").className = error ? "error" : "success";
}
try {
  const s = await local("status");
  $("#setup").hidden = !s.needs_admin;
  $("#ready").hidden = s.needs_admin;
  $("#extras").hidden = false;
  message(
    s.needs_admin
      ? "Falta só criar seu acesso."
      : "Tudo iniciado. Pode usar seu site.",
  );
} catch (e) {
  message(e.message, true);
}
$("#owner").onsubmit = async (e) => {
  e.preventDefault();
  const b = Object.fromEntries(new FormData(e.target)),
    button = e.target.querySelector("button");
  button.disabled = true;
  try {
    await local("owner", b);
    const session = await fetch("/api/session").then((r) => r.json());
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
      },
      body: JSON.stringify({ email: b.email, password: b.password }),
    });
    if (!r.ok) {
      $("#setup").hidden = true;
      $("#ready").hidden = false;
      throw Error(
        "Administrador criado. Clique em Administrar eventos e entre com sua senha.",
      );
    }
    location.assign("/#admin");
  } catch (err) {
    message(err.message, true);
  } finally {
    button.disabled = false;
  }
};
$("#mail").onclick = async () => {
  try {
    const rows = await local("mail"),
      list = $("#mail-list");
    list.replaceChildren();
    if (!rows.length) {
      list.textContent =
        "Nenhuma mensagem. Use “Esqueci minha senha” na tela de login e volte aqui.";
      return;
    }
    for (const m of rows) {
      const item = document.createElement("article"),
        heading = document.createElement("strong"),
        text = document.createElement("p");
      heading.textContent = m.subject + " · " + m.to;
      text.textContent = m.text;
      item.append(heading, text);
      const token = m.text.match(/#reset=([a-f0-9]{64})/);
      if (token) {
        const a = document.createElement("a");
        a.href = "/#reset=" + token[1];
        a.textContent = "Redefinir minha senha";
        item.append(a);
      }
      list.append(item);
    }
  } catch (e) {
    message(e.message, true);
  }
};
$("#stop").onclick = async () => {
  try {
    await local("stop", {});
    $("#setup").hidden = true;
    $("#ready").hidden = true;
    $("#extras").hidden = true;
    message(
      "Encerrando o site. Aguarde a mensagem de conclusão na janela do programa. Para abrir novamente, use ABRIR_INGRESSOS.bat.",
    );
  } catch (e) {
    message(e.message, true);
  }
};
