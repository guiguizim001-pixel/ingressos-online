const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(n) / 100,
  );
const date = (x) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(x));
const statusNames = {
  pending: "Aguardando pagamento",
  approved: "Pagamento aprovado",
  rejected: "Pagamento recusado",
  cancelled: "Não concluído / expirado",
  refunded: "Reembolsado",
  disputed: "Em contestação",
  awaiting_payment: "Aguardando pagamento",
  ready: "Pagamento confirmado",
  valid: "Válido",
  used: "Entrada registrada",
  revoked: "Bloqueado",
  published: "Publicado",
  draft: "Rascunho",
  cancelled: "Cancelado",
  blocked: "Análise do atendimento",
};
const badge = (x) =>
  `<span class="badge ${esc(x)}">${esc(statusNames[x] || x)}</span>`;
const safeImage = (u) =>
  typeof u === "string" &&
  (/^\/(assets|uploads)\/[a-zA-Z0-9_.-]+$/.test(u) || /^https:\/\//.test(u))
    ? u
    : "/assets/placeholder.svg";
const imageFor = (p) => safeImage(p.images?.[0]?.url);
let user = null,
  csrf = "",
  store,
  events = [],
  cart = [],
  adminEvents = [],
  adminCategories = [],
  toastTimer;
try {
  cart = JSON.parse(localStorage.getItem("ingressos-cart") || "[]");
  if (!Array.isArray(cart)) cart = [];
  cart = cart
    .filter(
      (x) =>
        typeof x.lot_id === "string" &&
        Number.isInteger(x.quantity) &&
        x.quantity > 0 &&
        x.quantity <= 20,
    )
    .slice(0, 20);
} catch {
  cart = [];
}
async function api(url, { method = "GET", body, headers = {} } = {}) {
  const multipart = body instanceof FormData;
  const r = await fetch("/api" + url, {
    method,
    credentials: "same-origin",
    headers: {
      ...(multipart ? {} : { "Content-Type": "application/json" }),
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...headers,
    },
    ...(body !== undefined
      ? { body: multipart ? body : JSON.stringify(body) }
      : {}),
  });
  const data = await r
    .json()
    .catch(() => ({ error: "Resposta inválida do servidor." }));
  if (!r.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}
async function refreshSession() {
  const s = await api("/session");
  user = s.user;
  csrf = s.csrf;
  $("#account-button span:last-child").textContent = user
    ? user.name.split(" ")[0]
    : "Minha conta";
}
function toast(t) {
  $("#toast").textContent = t;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 5000);
}
function saveCart() {
  try {
    localStorage.setItem("ingressos-cart", JSON.stringify(cart));
    localStorage.removeItem("ingressos-checkout-key");
  } catch {}
  $("#cart-count").textContent = cart.reduce((s, i) => s + i.quantity, 0);
}
function openModal(title, html) {
  $("#modal-content").innerHTML =
    `<h2 id="modal-title">${esc(title)}</h2>${html}`;
  if (!$("#modal").open) $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
}
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = $("#modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
$("#cart-button").onclick = () => (location.hash = "cart");
$("#account-button").onclick = () =>
  user ? (location.hash = "account") : authModal();
$("#policy-button").onclick = () =>
  openModal(
    "Informações e atendimento",
    `<p class="description">${esc(store.settings.policies).replace(/\n/g, "<br>")}</p><p>${esc(store.settings.contact || "Contato ainda não configurado.")}</p>`,
  );
function bindForm(id, fn) {
  const form = $(id);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = $('button[type="submit"]', form);
    const error = $(".form-error", form);
    if (error) error.innerHTML = "";
    if (button) button.disabled = true;
    try {
      await fn(Object.fromEntries(new FormData(form)), form);
    } catch (err) {
      if (error)
        error.innerHTML = `<p class="error" role="alert">${esc(err.message)}</p>`;
      else toast(err.message);
    } finally {
      if (button) button.disabled = false;
    }
  });
}
const errSlot = '<div class="form-error" aria-live="polite"></div>';
const field = (name, label, value = "", extra = "") =>
  `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" ${extra}></label>`;
function authModal(mode = "login") {
  openModal(
    mode === "register"
      ? "Crie sua conta"
      : mode === "forgot"
        ? "Recuperar senha"
        : "Bom ter você aqui.",
    `<p class="muted">${mode === "forgot" ? "Enviaremos as instruções por e-mail." : "Sua conta independente, seus pedidos em um só lugar."}</p><form id="auth-form" class="stack">${mode === "register" ? field("name", "Seu nome", "", 'required autocomplete="name" maxlength="160"') : ""}${field("email", "E-mail", "", 'type="email" required autocomplete="email"')}${mode !== "forgot" ? field("password", "Senha" + (mode === "register" ? " · mínimo de 12 caracteres" : ""), "", `type="password" required minlength="${mode === "register" ? 12 : 1}" maxlength="128" autocomplete="${mode === "register" ? "new-password" : "current-password"}"`) : ""}${errSlot}<button type="submit" class="primary">${mode === "register" ? "Criar minha conta" : mode === "forgot" ? "Enviar instruções" : "Entrar"}</button></form><div class="row auth-tabs"><button class="text-button" id="auth-switch">${mode === "login" ? "Ainda não tenho conta" : "Já tenho uma conta"}</button>${mode === "login" ? '<button class="text-button" id="auth-forgot">Esqueci minha senha</button>' : ""}</div>`,
  );
  $("#auth-switch").onclick = () =>
    authModal(mode === "login" ? "register" : "login");
  if ($("#auth-forgot")) $("#auth-forgot").onclick = () => authModal("forgot");
  bindForm("#auth-form", async (b) => {
    const r = await api("/auth/" + mode, { method: "POST", body: b });
    if (mode === "forgot") {
      openModal(
        "Confira seu e-mail",
        `<p>${esc(r.message)}</p>${store.payment.mode === "disabled" ? (store.local_easy ? '<p class="muted">Abra o painel inicial do modo fácil e clique em E-mails de teste para acessar a recuperação.</p><a href="/iniciar">Abrir painel inicial</a>' : '<p class="muted">Em desenvolvimento, consulte a caixa Mailpit em localhost:8025.</p>') : ""}`,
      );
      return;
    }
    await refreshSession();
    closeModal();
    toast(
      mode === "register"
        ? "Conta criada com sucesso."
        : "Você entrou na sua conta.",
    );
    if (
      location.hash === "#checkout" ||
      location.hash === "#account" ||
      location.hash.startsWith("#order/") ||
      location.hash.startsWith("#admin")
    )
      await route();
  });
}
const activeLot = (l) =>
  l.active &&
  l.available > 0 &&
  new Date(l.sales_start) <= new Date() &&
  new Date(l.sales_end) > new Date();
const minPrice = (e) => {
  const prices = e.lots.filter(activeLot).map((l) => l.price_cents);
  return prices.length ? Math.min(...prices) : null;
};
const eventDate = (x) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(x));
const action = (fn) => async () => {
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  }
};
const buttonAction = (id, fn) => {
  if ($(id)) $(id).onclick = action(fn);
};
const page = (html) => {
  $("#main").innerHTML = html;
};
const block = (title, html) =>
  `<section class="section"><div class="section-heading"><div><div class="eyebrow">SEU INGRESSO</div><h1>${esc(title)}</h1></div></div>${html}</section>`;
const empty = (text) =>
  `<div class="empty"><span><svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></span><h2>${esc(text)}</h2><a class="primary" href="#catalog">Explorar eventos</a></div>`;
function eventCard(e) {
  const price = minPrice(e);
  return `<article class="event-card"><a class="event-photo" href="#event/${e.id}"><img src="${esc(imageFor(e))}" alt="Cartaz de ${esc(e.name)}" loading="lazy">${e.demo ? '<span class="demo-tag">EVENTO DE EXEMPLO</span>' : ""}<span class="date-tag">${esc(eventDate(e.starts_at))}</span></a><div class="event-info"><small>${esc(e.category || "Evento")} · ${esc(date(e.starts_at))}</small><h3><a href="#event/${e.id}">${esc(e.name)}</a></h3><p>${esc(e.venue)} · ${esc(e.city)}</p><div class="card-bottom"><span>${price === null ? "Vendas indisponíveis" : `A partir de <strong>${money(price)}</strong>`}</span><a href="#event/${e.id}" aria-label="Ver ${esc(e.name)}"><svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></a></div></div></article>`;
}
function home() {
  const e = [...events].sort(
    (a, b) => new Date(a.starts_at) - new Date(b.starts_at),
  )[0];
  page(
    `<section class="hero"><div class="hero-copy"><div class="eyebrow"><span class="live-dot"></span> MAIS HISTÓRIAS PARA VIVER</div><h1>O próximo<br>momento<br><em>é seu.</em></h1><p>Shows, festivais e experiências.<br>Encontre seu lugar e esteja presente.</p><a href="#catalog" class="primary">Encontre seu próximo evento <span><svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></span></a><div class="hero-foot">INGRESSO DIGITAL <span>•</span> COMPRA ONLINE</div></div>${e ? `<a class="hero-poster" href="#event/${e.id}"><img src="${esc(imageFor(e))}" alt="${esc(e.name)}"><div class="hero-poster-info"><span class="eyebrow">EM DESTAQUE${e.demo ? " · EXEMPLO" : ""}</span><h2>${esc(e.name)}</h2><p>${esc(date(e.starts_at))} · ${esc(e.city)}</p><span class="circle-arrow"><svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></span></div></a>` : ""}</section><section class="category-strip"><span>ENCONTRE A SUA VIBE</span>${store.categories.map((c) => `<a href="#catalog?category=${encodeURIComponent(c.name)}">${esc(c.name)} <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></a>`).join("")}</section><section class="section"><div class="section-heading"><div><div class="eyebrow">ESCOLHA O SEU PRÓXIMO DESTINO</div><h2>Vai acontecer.</h2></div><a class="text-button" href="#catalog">Ver todos os eventos <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></a></div><div class="event-grid">${events.slice(0, 4).map(eventCard).join("") || empty("Novos eventos em breve.")}</div></section><section class="benefits"><div><b>01</b><h3>Escolha a experiência</h3><p>Confira o evento, o local e o lote disponível.</p></div><div><b>02</b><h3>Garanta seu lugar</h3><p>Informe os participantes e pague online.</p></div><div><b>03</b><h3>Leve seu ingresso</h3><p>Após o pagamento confirmado, acesse o QR Code na sua conta.</p></div></section>`,
  );
}
function catalogPage() {
  const selected =
    new URLSearchParams(location.hash.split("?")[1] || "").get("category") ||
    "";
  page(
    block(
      "Encontre sua próxima experiência.",
      `<form id="filters" class="filters">${field("q", "Buscar evento", "", 'type="search" placeholder="Show, festival, experiência…"')}<label>Categoria<select name="category"><option value="">Todas</option>${store.categories.map((c) => `<option ${c.name === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label><label>Cidade<select name="city"><option value="">Todas</option>${[...new Set(events.map((e) => e.city))].map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>${field("day", "A partir de", "", 'type="date"')}</form><p class="muted" id="result-count"></p><div class="event-grid" id="catalog-grid"></div>`,
    ),
  );
  const render = () => {
    const b = Object.fromEntries(new FormData($("#filters"))),
      list = events
        .filter(
          (e) =>
            (e.name + " " + e.venue)
              .toLowerCase()
              .includes(b.q.toLowerCase()) &&
            (!b.category || e.category === b.category) &&
            (!b.city || e.city === b.city) &&
            (!b.day ||
              new Date(e.starts_at) >= new Date(b.day + "T00:00:00-03:00")),
        )
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    $("#catalog-grid").innerHTML =
      list.map(eventCard).join("") ||
      "<p>Nenhum evento encontrado com esses filtros.</p>";
    $("#result-count").textContent = `${list.length} evento(s) encontrado(s)`;
  };
  $("#filters").onsubmit = (e) => e.preventDefault();
  $("#filters").oninput = render;
  render();
}
function eventPage(id) {
  const e = events.find((x) => x.id === id);
  if (!e)
    return page(
      block("Evento indisponível", empty("Este evento não está à venda.")),
    );
  page(
    `<section class="section"><a class="back" href="#catalog">← Todos os eventos</a><div class="event-detail"><div><img class="detail-poster" src="${esc(imageFor(e))}" alt="${esc(e.name)}"><div class="panel"><div class="eyebrow">SOBRE A EXPERIÊNCIA</div><h2>${esc(e.name)}</h2><p class="preline">${esc(e.description)}</p><h3>Local e programação</h3><p>${esc(e.venue)} · ${esc(e.city)}<br>${esc(e.address)}</p><p>Início: ${date(e.starts_at)}<br>Término: ${date(e.ends_at)}<br>Abertura da entrada: ${date(e.checkin_opens_at)}</p><h3>Informações importantes</h3><p class="preline">${esc(e.rules)}</p><p class="muted">Organização: ${esc(e.organizer)} · Horário de Brasília</p></div></div><aside class="panel ticket-picker"><div class="eyebrow">${esc(e.category || "EVENTO")}</div><h1>${esc(e.name)}</h1><p>${esc(date(e.starts_at))}<br>${esc(e.venue)} · ${esc(e.city)}</p>${e.demo ? '<p class="notice">Evento fictício para testar o sistema. Não é uma programação real.</p>' : ""}<h3>Escolha seus ingressos</h3><form id="tickets-form">${e.lots.map((l) => `<label class="lot-row"><span><strong>${esc(l.ticket_type)}</strong><small>${esc(l.lot_name)} · ${money(l.price_cents)}</small><small>${activeLot(l) ? `Até ${l.max_per_order} por pedido` : "Indisponível neste momento"}</small></span><select name="${l.id}" aria-label="Quantidade de ${esc(l.ticket_type)}" ${activeLot(l) ? "" : "disabled"}>${Array.from({ length: activeLot(l) ? Math.min(l.max_per_order, l.available, 20) + 1 : 1 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}</select></label>`).join("")}${errSlot}<button class="primary full" type="submit">Adicionar ao carrinho <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></button></form><p class="muted small">O ingresso digital fica disponível na sua conta após a confirmação do pagamento.</p></aside></div></section>`,
  );
  bindForm("#tickets-form", (b) => {
    let count = 0;
    for (const [id, n] of Object.entries(b)) {
      const qty = Number(n);
      if (!qty) continue;
      count += qty;
      const old = cart.find((x) => x.lot_id === id);
      const l = e.lots.find((x) => x.id === id);
      if ((old?.quantity || 0) + qty > l.max_per_order)
        throw Error(
          "O carrinho ultrapassa o limite deste lote. Ajuste a quantidade.",
        );
    }
    if (!count) throw Error("Escolha pelo menos um ingresso.");
    if (cart.reduce((s, i) => s + i.quantity, 0) + count > 20)
      throw Error("Limite de 20 ingressos por pedido.");
    for (const [id, n] of Object.entries(b)) {
      const qty = Number(n);
      if (!qty) continue;
      const old = cart.find((x) => x.lot_id === id);
      if (old) old.quantity += qty;
      else cart.push({ lot_id: id, quantity: qty });
    }
    saveCart();
    location.hash = "cart";
  });
}
function cartItems() {
  return cart.map((i) => {
    const e = events.find((e) => e.lots.some((l) => l.id === i.lot_id));
    return { ...i, event: e, lot: e?.lots.find((l) => l.id === i.lot_id) };
  });
}
function cartPage() {
  const items = cartItems();
  page(
    block(
      "Seu próximo momento.",
      !items.length
        ? empty("Seu carrinho está vazio.")
        : `<div class="checkout-grid"><div class="panel">${items.map((i) => `<div class="cart-row"><div><h3>${esc(i.event?.name || "Evento indisponível")}</h3><p>${esc(i.lot?.ticket_type || "Lote indisponível")} · ${esc(i.lot?.lot_name || "")}</p>${i.event ? `<small>${date(i.event.starts_at)} · ${esc(i.event.city)}</small>` : ""}</div><label>Quantidade<input class="qty" data-qty="${i.lot_id}" type="number" min="1" max="${i.lot?.max_per_order || 20}" value="${i.quantity}"></label><strong>${money((i.lot?.price_cents || 0) * i.quantity)}</strong><button class="text-button" data-remove="${i.lot_id}">Remover</button></div>`).join("")}</div><aside class="panel"><div class="eyebrow">RESUMO</div><h2>${items.reduce((s, i) => s + i.quantity, 0)} ingresso(s)</h2><p>Subtotal <strong>${money(items.reduce((s, i) => s + i.quantity * (i.lot?.price_cents || 0), 0))}</strong></p><p class="muted">O valor final e a disponibilidade serão conferidos na próxima etapa.</p><a class="primary full" href="#checkout">Continuar compra <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></a><a class="back" href="#catalog">Escolher outros eventos</a></aside></div>`,
    ),
  );
  $$("[data-remove]").forEach(
    (b) =>
      (b.onclick = () => {
        cart = cart.filter((i) => i.lot_id !== b.dataset.remove);
        saveCart();
        cartPage();
      }),
  );
  $$("[data-qty]").forEach(
    (el) =>
      (el.onchange = () => {
        const i = cart.find((i) => i.lot_id === el.dataset.qty),
          n = Number(el.value);
        if (
          !Number.isInteger(n) ||
          n < 1 ||
          n > Number(el.max) ||
          cart.reduce((s, x) => s + (x === i ? n : x.quantity), 0) > 20
        ) {
          toast("Confira a quantidade e o limite de 20 ingressos por pedido.");
          el.value = i.quantity;
          return;
        }
        i.quantity = n;
        saveCart();
        cartPage();
      }),
  );
}
function checkoutPage() {
  if (!user) {
    page(
      block(
        "Entre para continuar.",
        `<p>Sua conta guarda os ingressos e o histórico de compras.</p><button id="login-now" class="primary">Entrar ou criar conta</button>`,
      ),
    );
    buttonAction("#login-now", () => authModal());
    return;
  }
  const items = cartItems();
  if (!items.length) return cartPage();
  if (items.some((i) => !i.event || !i.lot || !activeLot(i.lot)))
    return page(
      block(
        "Confira seu carrinho",
        `<p>Um evento ou lote está indisponível. Ajuste seus ingressos antes de continuar.</p><a class="primary" href="#cart">Revisar carrinho</a>`,
      ),
    );
  page(
    block(
      "Quase lá. Quem vai com você?",
      `<form id="checkout-form" class="checkout-grid"><div class="panel stack"><h2>Dados do comprador</h2>${field("name", "Nome completo", user.name, 'required maxlength="160" autocomplete="name"')}${field("phone", "Telefone com DDD", user.phone, 'required inputmode="tel" maxlength="20"')}<h2>Participantes</h2>${items.map((i, index) => `<fieldset><legend>${esc(i.event.name)} · ${esc(i.lot.ticket_type)} · ${esc(i.lot.lot_name)}</legend>${Array.from({ length: i.quantity }, (_, n) => field("attendee-" + index + "-" + n, "Nome do participante " + (n + 1), n === 0 && index === 0 ? user.name : "", 'required maxlength="160"')).join("")}</fieldset>`).join("")}</div><aside class="panel"><h2>Revisão da compra</h2>${items.map((i) => `<p>${i.quantity} × ${esc(i.event.name)}<br><small>${esc(i.lot.ticket_type)} · ${money(i.lot.price_cents * i.quantity)}</small></p>`).join("")}<p>Recebimento: ingresso digital na sua conta.</p><label class="check"><input name="agree" type="checkbox" required>Li as informações e regras dos eventos selecionados.</label>${errSlot}<button class="primary full" type="submit">Calcular e revisar total</button><div id="payment-review"></div>${!store.payment.enabled ? '<p class="notice">Pagamento ainda não configurado. Você pode conferir o fluxo e o total, mas nenhuma cobrança será criada.</p>' : ""}</aside></form>`,
    ),
  );
  let review = null;
  $("#checkout-form").oninput = () => {
    review = null;
    $("#payment-review").innerHTML = "";
  };
  bindForm("#checkout-form", async (b) => {
    const payload = {
      contact: { name: b.name, phone: b.phone.replace(/\D/g, "") },
      items: items.map((i, index) => ({
        lot_id: i.lot_id,
        quantity: i.quantity,
        attendees: Array.from(
          { length: i.quantity },
          (_, n) => b["attendee-" + index + "-" + n],
        ),
      })),
    };
    const q = await api("/quote", { method: "POST", body: payload });
    review = { ...payload, expected_total_cents: q.total_cents };
    $("#payment-review").innerHTML =
      `<div class="total"><span>Desconto ${money(q.discount_cents)}</span><h2>Total ${money(q.total_cents)}</h2><button type="button" class="primary full" id="pay-now" ${store.payment.enabled ? "" : "disabled"}>Ir ao pagamento <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></button><p class="small muted">A reserva é temporária. A confirmação depende do pagamento aprovado pelo Mercado Pago.</p></div>`;
    buttonAction("#pay-now", async () => {
      if (!review) return;
      const btn = $("#pay-now");
      btn.disabled = true;
      try {
        const serialized = JSON.stringify(review);
        let entry;
        try {
          entry = JSON.parse(sessionStorage.getItem("ingressos-checkout-key"));
        } catch {}
        if (!entry || entry.payload !== serialized)
          entry = { payload: serialized, key: crypto.randomUUID() };
        sessionStorage.setItem("ingressos-checkout-key", JSON.stringify(entry));
        const r = await api("/orders", {
          method: "POST",
          body: review,
          headers: { "Idempotency-Key": entry.key },
        });
        cart = [];
        saveCart();
        location.hash = "order/" + r.order_id;
        await route();
        if (r.checkout_url) location.assign(r.checkout_url);
        else toast(r.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}
async function accountPage() {
  if (!user) {
    page(
      block(
        "Meus ingressos",
        `<p>Entre na sua conta para acessar seus ingressos.</p><button class="primary" id="login-now">Entrar ou criar conta</button>`,
      ),
    );
    buttonAction("#login-now", () => authModal());
    return;
  }
  const orders = await api("/orders");
  page(
    block(
      "Olá, " + user.name.split(" ")[0] + ".",
      `<div class="row"><a class="chip active" href="#account">Meus ingressos e pedidos</a>${user.role === "admin" ? '<a class="chip" href="#admin">Painel administrativo <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></a>' : ""}<button class="text-button" id="logout">Sair da conta</button></div><div class="checkout-grid"><div><h2>Seu histórico</h2>${orders.length ? orders.map((o) => `<a href="#order/${o.id}" class="order-row"><span><strong>Pedido ${esc(o.id.slice(0, 8))}</strong><small>${date(o.created_at)}</small></span>${badge(o.payment_status)}<strong>${money(o.total_cents)} <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></strong></a>`).join("") : empty("Seus próximos ingressos estarão aqui.")}</div><form id="profile-form" class="panel stack"><h2>Seus dados</h2>${field("name", "Nome", user.name, 'required maxlength="160"')}${field("phone", "Telefone", user.phone, 'maxlength="30"')}<p class="muted">${esc(user.email)}</p>${errSlot}<button type="submit" class="primary">Salvar dados</button></form></div>`,
    ),
  );
  buttonAction("#logout", async () => {
    await api("/auth/logout", { method: "POST", body: {} });
    await refreshSession();
    location.hash = "home";
  });
  bindForm("#profile-form", async (b) => {
    await api("/profile", { method: "PATCH", body: b });
    await refreshSession();
    toast("Dados salvos.");
  });
}
async function orderPage(id) {
  if (!user) return accountPage();
  const [o, tickets] = await Promise.all([
    api("/orders/" + id),
    api("/orders/" + id + "/tickets"),
  ]);
  page(
    block(
      "Seu pedido " + o.id.slice(0, 8),
      `<div class="row no-print">${badge(o.payment_status)}<button class="chip" id="refresh-order">Atualizar situação</button><a class="back" href="#account">Meus pedidos</a></div><div class="panel no-print"><h2>${money(o.total_cents)}</h2>${o.items.map((i) => `<p>${i.quantity} × ${esc(i.name)} · ${esc(i.lot_name)} · ${esc(i.ticket_type)}</p>`).join("")}${o.order_kind === "legacy_physical" ? '<p class="notice">Pedido do sistema anterior, preservado no histórico. Não emite ingressos.</p>' : ""}${o.exception ? '<p class="error">Este pedido precisa de análise do atendimento. Os ingressos não estão liberados. Entre em contato com a organização.</p>' : ""}${!tickets.length ? "<p>Os ingressos são emitidos somente após a confirmação do pagamento.</p>" : ""}${!o.stock_committed && new Date(o.expires_at) > new Date() && !o.exception ? '<button class="primary" id="retry-pay">Acessar pagamento</button>' : ""}<p class="muted">Reserva até ${date(o.expires_at)}. Retornar do pagamento não confirma a compra; aguarde a atualização do provedor.</p></div>${tickets.length ? '<div class="row no-print"><h2>Seus ingressos digitais</h2><button class="chip" id="print-tickets">Imprimir / salvar PDF</button></div>' : ""}<div class="tickets">${tickets.map((t) => `<article class="digital-ticket"><div><div class="eyebrow">SEU INGRESSO · ${esc(t.event_snapshot?.name || "")}</div><h2>${esc(t.attendee_name)}</h2><p>${esc(t.lot_name)} · ${esc(t.ticket_type)}</p><p>${date(t.current_starts_at)}<br>${esc(t.current_venue)} · ${esc(t.current_city)}</p>${badge(t.status)}${t.event_status === "cancelled" ? '<p class="error">Evento cancelado. Procure a organização.</p>' : ""}<p class="small muted">Documento nominal. Confira as regras de entrada do evento.</p></div><div class="qr">${t.usable ? `<img src="${t.qr}" alt="QR Code do ingresso de ${esc(t.attendee_name)}"><code>${esc(t.code)}</code><small>Apresente este código na entrada.<br>Não compartilhe seu ingresso.</small>` : "<p>QR Code indisponível para entrada.</p>"}</div></article>`).join("")}</div>`,
    ),
  );
  buttonAction("#refresh-order", () => orderPage(id));
  buttonAction("#print-tickets", () => window.print());
  buttonAction("#retry-pay", async () => {
    const r = await api("/orders/" + id + "/payment", {
      method: "POST",
      body: {},
    });
    if (r.checkout_url) location.assign(r.checkout_url);
    else toast(r.message);
  });
}
const localDate = (x) =>
  x
    ? new Date(new Date(x).getTime() - 3 * 3600000).toISOString().slice(0, 16)
    : "";
const isoDate = (x) => new Date(x + ":00-03:00").toISOString();
function adminNav() {
  return `<div class="tabs no-print"><a class="chip" href="#admin">Visão geral</a><a class="chip" href="#admin/events">Eventos e lotes</a><a class="chip" href="#admin/checkin">Controle de entrada</a><a class="chip" href="#admin/orders">Pedidos</a><a class="chip" href="#admin/settings">Configurações</a></div>`;
}
const adminPage = (title, html) => page(block(title, adminNav() + html));
async function adminRoute(sub, id) {
  if (user?.role !== "admin") {
    page(
      block(
        "Acesso restrito",
        `<p>Entre com a conta administradora.</p><button class="primary" id="login-now">Entrar</button>`,
      ),
    );
    buttonAction("#login-now", () => authModal());
    return;
  }
  if (!sub) {
    const d = await api("/admin/dashboard");
    adminPage(
      "Seu evento, sob controle.",
      `<div class="stat-grid">${d.tickets.map((x) => `<div class="panel"><small>${esc(statusNames[x.status] || x.status)}</small><h2>${x.count}</h2><span>ingresso(s)</span></div>`).join("") || '<div class="panel"><h2>0</h2><p>Ingressos emitidos</p></div>'}<div class="panel"><h2>${d.exceptions}</h2><p>Pedidos com ocorrências</p></div></div><h2>Pagamentos</h2><div class="table-wrap"><table><thead><tr><th>Situação</th><th>Pedidos</th><th>Total bruto</th></tr></thead><tbody>${d.stats.map((x) => `<tr><td>${badge(x.payment_status)}</td><td>${x.count}</td><td>${money(x.cents)}</td></tr>`).join("")}</tbody></table></div><p>Reembolsos registrados: ${money(d.refund_cents)}</p><p class="notice">Configure seus eventos reais e teste o pagamento antes de abrir as vendas. Os eventos iniciais são exemplos.</p>`,
    );
    return;
  }
  if (sub === "events" || sub === "event") {
    adminEvents = await api("/admin/events");
    adminCategories = await api("/admin/categories");
    if (sub === "event") return eventEditor(id);
    adminPage(
      "Eventos e lotes",
      `<a class="primary" href="#admin/event/new">Criar evento +</a><div class="event-admin-list">${adminEvents.map((e) => `<a class="order-row" href="#admin/event/${e.id}"><span><strong>${esc(e.name)}</strong><small>${e.starts_at ? date(e.starts_at) : "Defina data e local"} · ${esc(e.city)}</small></span>${badge(e.status)}<span>${e.lots.length} lote(s) <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></span></a>`).join("")}</div>`,
    );
    return;
  }
  if (sub === "checkin") {
    adminEvents = await api("/admin/events");
    adminPage(
      "Controle de entrada",
      `<div class="checkout-grid"><form id="checkin-form" class="panel stack"><h2>Conferir ingresso</h2><p>Selecione o evento e leia o QR Code com um leitor USB ou cole o código do ingresso. A conferência exige internet.</p><label>Evento<select name="event_id" required><option value="">Selecione</option>${adminEvents
        .filter((e) => e.status === "published")
        .map(
          (e) =>
            `<option value="${e.id}">${esc(e.name)} · ${date(e.starts_at)}</option>`,
        )
        .join(
          "",
        )}</select></label>${field("code", "Código do ingresso", "", 'required autocomplete="off" placeholder="EVT-…" maxlength="100"')}${errSlot}<button type="submit" class="primary">Verificar ingresso</button><div id="entry-result" aria-live="polite"></div></form><aside class="panel"><h2>Participantes</h2><p>Escolha um evento para consultar os ingressos emitidos e as entradas registradas.</p><button class="chip" id="load-attendees">Carregar lista do evento</button><div id="attendees"></div></aside></div>`,
    );
    let verifying = null;
    $("#checkin-form").oninput = () => {
      verifying = null;
      $("#entry-result").innerHTML = "";
    };
    bindForm("#checkin-form", async (b) => {
      verifying = null;
      $("#entry-result").innerHTML = "";
      const r = await api("/admin/checkin/verify", { method: "POST", body: b });
      verifying = { ...b };
      $("#entry-result").innerHTML =
        `<div class="success"><h2>${esc(r.attendee_name)}</h2><p>${esc(r.message)}</p><button type="button" class="primary" id="confirm-entry">Confirmar entrada</button></div>`;
      buttonAction("#confirm-entry", async () => {
        if (!verifying) return;
        const b = verifying;
        verifying = null;
        $("#confirm-entry").disabled = true;
        try {
          const result = await api("/admin/checkin/confirm", {
            method: "POST",
            body: b,
          });
          $("#entry-result").innerHTML =
            `<div class="success"><h2>Entrada confirmada ✓</h2><p>${esc(result.attendee_name)}</p></div>`;
          $("#checkin-form [name=code]").value = "";
          $("#checkin-form [name=code]").focus();
        } catch (e) {
          $("#entry-result").innerHTML =
            `<p class="error">${esc(e.message)}</p>`;
        }
      });
    });
    buttonAction("#load-attendees", async () => {
      const id = $("#checkin-form [name=event_id]").value;
      if (!id) throw Error("Selecione um evento.");
      const rows = await api("/admin/events/" + id + "/attendees");
      $("#attendees").innerHTML =
        `<p>${rows.length} ingresso(s) · ${rows.filter((t) => t.status === "used").length} entrada(s)</p><div class="attendee-list">${rows.map((t) => `<div class="attendee"><strong>${esc(t.attendee_name)}</strong><small>${esc(t.lot_name)} · ${esc(t.ticket_type)}</small>${badge(t.status)}</div>`).join("")}</div>`;
    });
    return;
  }
  if (sub === "orders") {
    const rows = await api("/admin/orders");
    adminPage(
      "Pedidos e pagamentos",
      `<form id="order-search" class="row">${field("search", "Buscar por e-mail ou pedido", "", 'type="search"')}<label>Situação<select name="status"><option value="">Todas</option>${["pending", "approved", "rejected", "cancelled", "refunded", "disputed"].map((s) => `<option value="${s}">${statusNames[s]}</option>`).join("")}</select></label><button type="submit" class="chip">Buscar</button>${errSlot}</form><div id="admin-order-list"></div>`,
    );
    const render = (rows) => {
      $("#admin-order-list").innerHTML =
        rows
          .map(
            (o) =>
              `<button class="order-row full" data-order="${o.id}"><span><strong>${esc(o.id.slice(0, 8))} · ${esc(o.email)}</strong><small>${date(o.created_at)}${o.exception ? " · REVISÃO NECESSÁRIA" : ""}</small></span>${badge(o.payment_status)}<strong>${money(o.total_cents)} <svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg></strong></button>`,
          )
          .join("") || "<p>Nenhum pedido encontrado.</p>";
      $$("[data-order]").forEach(
        (b) =>
          (b.onclick = action(async () => {
            const o = await api("/admin/orders/" + b.dataset.order);
            openModal(
              "Pedido " + o.id.slice(0, 8),
              `<p>${esc(o.contact.name)} · ${esc(o.contact.phone)}</p>${badge(o.payment_status)}<h3>${money(o.total_cents)}</h3>${o.items.map((i) => `<p>${i.quantity} × ${esc(i.name)} · ${esc(i.lot_name)} · ${esc(i.ticket_type)}</p>`).join("")}${o.exception ? `<p class="error">Ocorrência: ${esc(o.exception)}. Confira o pagamento e resolva com o comprador.</p>` : ""}<button class="chip" id="reconcile-one">Consultar pagamento novamente</button><p class="muted">A aprovação depende da confirmação do Mercado Pago. Reembolsos são realizados na conta do provedor e sincronizados pelo sistema.</p>`,
            );
            buttonAction("#reconcile-one", async () => {
              const r = await api("/admin/reconcile", {
                method: "POST",
                body: { order_id: o.id },
              });
              toast(
                r.errors
                  ? "Consulta pendente. Verifique as configurações do pagamento."
                  : "Consulta concluída. Reabra o pedido para atualizar.",
              );
            });
          })),
      );
    };
    render(rows);
    bindForm("#order-search", async (b) => {
      const q = new URLSearchParams();
      if (b.status) q.set("status", b.status);
      q.set("search", b.search);
      render(await api("/admin/orders?" + q));
    });
    return;
  }
  if (sub === "settings") {
    adminCategories = await api("/admin/categories");
    const s = store.settings;
    adminPage(
      "A identidade do seu site",
      `<div class="checkout-grid"><form id="settings-form" class="panel stack">${field("name", "Nome do site", s.name, 'required maxlength="160"')}${field("tagline", "Frase de apresentação", s.tagline, 'maxlength="160"')}${field("accent", "Cor de destaque", s.accent, 'type="color"')}${field("contact", "Atendimento / contato", s.contact, 'maxlength="300"')}${field("logo_url", "URL HTTPS do logotipo", s.logo_url)}${field("discount_percent", "Desconto geral (%)", s.discount_percent, 'type="number" min="0" max="50" required')}<label>Políticas e informações<textarea name="policies" rows="8" maxlength="20000">${esc(s.policies)}</textarea></label>${errSlot}<button type="submit" class="primary">Salvar configurações</button></form><div><form id="category-form" class="panel stack"><h2>Categorias</h2>${field("name", "Nova categoria", "", 'required maxlength="160"')}${errSlot}<button type="submit" class="chip">Adicionar categoria</button><div>${adminCategories.map((c) => `<p>${esc(c.name)} <button type="button" class="text-button" data-category-toggle="${c.id}">${c.active ? "Desativar" : "Ativar"}</button></p>`).join("")}</div></form><form id="logo-form" class="panel stack"><h2>Logotipo</h2><input type="file" name="image" accept="image/png,image/jpeg,image/webp" required aria-label="Imagem do logotipo">${errSlot}<button class="chip" type="submit">Enviar logo</button><small>PNG, JPG ou WebP, até 5 MB. Depois salve as configurações.</small></form></div></div>`,
    );
    bindForm("#settings-form", async (b) => {
      b.discount_percent = Number(b.discount_percent);
      await api("/admin/settings", { method: "PUT", body: b });
      await loadStore();
      toast("Configurações salvas.");
    });
    bindForm("#category-form", async (b) => {
      await api("/admin/categories", {
        method: "POST",
        body: { name: b.name, active: true },
      });
      await loadStore();
      await adminRoute("settings");
    });
    $$("[data-category-toggle]").forEach(
      (b) =>
        (b.onclick = action(async () => {
          const c = adminCategories.find(
            (c) => c.id === b.dataset.categoryToggle,
          );
          await api("/admin/categories/" + c.id, {
            method: "PUT",
            body: { name: c.name, active: !c.active },
          });
          await loadStore();
          await adminRoute("settings");
        })),
    );
    bindForm("#logo-form", async (b, f) => {
      const r = await api("/admin/logo", {
        method: "POST",
        body: new FormData(f),
      });
      $("#settings-form [name=logo_url]").value = r.url;
      toast("Logo enviado. Salve as configurações.");
    });
    return;
  }
  adminPage("Página não encontrada", '<a href="#admin">Voltar ao painel</a>');
}
function eventEditor(id) {
  const e = adminEvents.find((x) => x.id === id) || {
    id: "new",
    name: "",
    description: "",
    active: true,
    demo: false,
    status: "draft",
    capacity: 100,
    venue: "",
    city: "",
    address: "",
    organizer: "",
    rules: "",
    lots: [],
    images: [],
  };
  adminPage(
    e.id === "new" ? "Criar evento" : e.name,
    `<form id="event-form" class="panel stack"><div class="form-grid">${field("name", "Nome do evento", e.name, 'required maxlength="160"')}<label>Categoria<select name="category_id"><option value="">Sem categoria</option>${adminCategories.map((c) => `<option value="${c.id}" ${e.category_id === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>${field("starts_at", "Início (Brasília)", localDate(e.starts_at), 'type="datetime-local" required')}${field("ends_at", "Término (Brasília)", localDate(e.ends_at), 'type="datetime-local" required')}${field("checkin_opens_at", "Abertura da entrada (Brasília)", localDate(e.checkin_opens_at), 'type="datetime-local" required')}${field("capacity", "Capacidade total de participantes", e.capacity, 'type="number" min="1" required')}${field("venue", "Local / espaço", e.venue, 'required maxlength="160"')}${field("city", "Cidade e UF", e.city, 'required maxlength="160"')}${field("address", "Endereço do evento", e.address, 'required maxlength="160"')}${field("organizer", "Organização responsável", e.organizer, 'required maxlength="160"')}<label>Situação<select name="status">${["draft", "published", "cancelled"].map((s) => `<option value="${s}" ${e.status === s ? "selected" : ""}>${statusNames[s]}</option>`).join("")}</select></label><label>Visível / ativo<select name="active"><option value="true" ${e.active ? "selected" : ""}>Sim</option><option value="false" ${!e.active ? "selected" : ""}>Não</option></select></label></div><label>Descrição<textarea name="description" rows="4" maxlength="8000">${esc(e.description)}</textarea></label><label>Regras, classificação etária, acessibilidade e cancelamento<textarea name="rules" rows="5" maxlength="12000">${esc(e.rules)}</textarea></label><label class="check"><input name="demo" type="checkbox" ${e.demo ? "checked" : ""}>Evento demonstrativo / fictício</label>${errSlot}<button type="submit" class="primary">Salvar evento</button></form>${e.id === "new" ? "<p>Salve o evento para cadastrar os lotes e o cartaz.</p>" : `<div class="section-heading"><h2>Lotes de ingressos</h2><button class="chip" id="new-lot">Adicionar lote +</button></div><div class="table-wrap"><table><thead><tr><th>Lote / tipo</th><th>Preço</th><th>Disponível</th><th>Reservado</th><th>Ações</th></tr></thead><tbody>${e.lots.map((l) => `<tr><td>${esc(l.lot_name)} · ${esc(l.ticket_type)}${l.active ? "" : " (inativo)"}</td><td>${money(l.price_cents)}</td><td>${l.available}</td><td>${l.reserved}</td><td><button class="text-button" data-lot="${l.id}">Editar</button> <button class="text-button" data-stock="${l.id}">Quantidade / histórico</button></td></tr>`).join("")}</tbody></table></div><p class="muted">A capacidade total é respeitada entre todos os lotes. As reservas ocupam vagas até expirar. Quantidades vendidas não são repostas automaticamente em reembolsos.</p><form id="poster-form" class="panel stack"><h2>Cartaz e imagens</h2><div class="poster-list">${e.images.map((i) => `<div><img src="${esc(safeImage(i.url))}" alt="Cartaz"><button type="button" class="text-button" data-cover="${i.id}">Usar como capa</button><button type="button" class="text-button" data-image="${i.id}">Remover</button></div>`).join("")}</div><input type="file" name="image" accept="image/png,image/jpeg,image/webp" required aria-label="Cartaz do evento"><small>PNG, JPG ou WebP, até 5 MB.</small>${errSlot}<button type="submit" class="chip">Enviar imagem</button></form>`}`,
  );
  bindForm("#event-form", async (b, f) => {
    const data = {
      ...b,
      category_id: b.category_id || null,
      active: b.active === "true",
      demo: !!b.demo,
      capacity: Number(b.capacity),
      starts_at: isoDate(b.starts_at),
      ends_at: isoDate(b.ends_at),
      checkin_opens_at: isoDate(b.checkin_opens_at),
    };
    const result = await api(
      "/admin/events" + (e.id === "new" ? "" : "/" + e.id),
      { method: e.id === "new" ? "POST" : "PUT", body: data },
    );
    await loadStore();
    toast("Evento salvo.");
    if (e.id === "new") location.hash = "admin/event/" + result.id;
    else await adminRoute("event", e.id);
  });
  buttonAction("#new-lot", () => lotEditor(e));
  $$("[data-lot]").forEach(
    (b) =>
      (b.onclick = () =>
        lotEditor(
          e,
          e.lots.find((l) => l.id === b.dataset.lot),
        )),
  );
  $$("[data-stock]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        const l = e.lots.find((l) => l.id === b.dataset.stock),
          rows = await api("/admin/lots/" + l.id + "/movements");
        openModal(
          "Quantidade · " + l.lot_name,
          `<p>Disponível: ${l.available} · Reservado: ${l.reserved}</p><form id="stock-form" class="stack">${field("delta", "Adicionar / retirar ingressos", "", 'type="number" min="-100000" max="100000" required placeholder="Ex.: 50 ou -10"')}${field("reason", "Motivo do ajuste", "", 'required maxlength="160"')}${errSlot}<button class="primary" type="submit">Registrar ajuste</button></form><h3>Histórico</h3>${rows.map((r) => `<p>${date(r.created_at)} · ${r.delta > 0 ? "+" : ""}${r.delta} · ${esc(r.reason)}</p>`).join("")}`,
        );
        bindForm("#stock-form", async (b) => {
          await api("/admin/lots/" + l.id + "/stock", {
            method: "POST",
            body: { delta: Number(b.delta), reason: b.reason },
          });
          closeModal();
          await adminRoute("event", e.id);
        });
      })),
  );
  bindForm("#poster-form", async (b, f) => {
    await api("/admin/events/" + e.id + "/images", {
      method: "POST",
      body: new FormData(f),
    });
    await adminRoute("event", e.id);
  });
  $$("[data-image]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        await api("/admin/images/" + b.dataset.image, { method: "DELETE" });
        await adminRoute("event", e.id);
      })),
  );
  $$("[data-cover]").forEach(
    (b) =>
      (b.onclick = action(async () => {
        for (const i of e.images)
          await api("/admin/images/" + i.id, {
            method: "PATCH",
            body: { position: i.id === b.dataset.cover ? 0 : 1 },
          });
        await adminRoute("event", e.id);
      })),
  );
}
function lotEditor(e, l) {
  l = l || {
    sku: "",
    lot_name: "1º lote",
    ticket_type: "Inteira",
    price_cents: 0,
    active: true,
    sales_start: new Date(),
    sales_end: e.starts_at,
    max_per_order: 10,
  };
  openModal(
    l.id ? "Editar lote" : "Novo lote",
    `<form id="lot-form" class="stack">${field("sku", "Código único do lote", l.sku, 'required maxlength="160"')}${field("lot_name", "Nome do lote", l.lot_name, 'required maxlength="80"')}${field("ticket_type", "Tipo / setor", l.ticket_type, 'required maxlength="80"')}${field("price", "Preço por ingresso (R$)", (l.price_cents / 100).toFixed(2), 'type="number" step="0.01" min="0.01" required')}${field("sales_start", "Vendas a partir de (Brasília)", localDate(l.sales_start), 'type="datetime-local" required')}${field("sales_end", "Vendas até (Brasília)", localDate(l.sales_end), 'type="datetime-local" required')}${field("max_per_order", "Limite por pedido", l.max_per_order, 'type="number" min="1" max="20" required')}<label class="check"><input name="active" type="checkbox" ${l.active ? "checked" : ""}>Lote ativo</label><p class="muted">Após salvar, ajuste a quantidade de ingressos disponível.</p>${errSlot}<button type="submit" class="primary">Salvar lote</button></form>`,
  );
  bindForm("#lot-form", async (b) => {
    const data = {
      sku: b.sku,
      lot_name: b.lot_name,
      ticket_type: b.ticket_type,
      price_cents: Math.round(Number(b.price) * 100),
      active: !!b.active,
      sales_start: isoDate(b.sales_start),
      sales_end: isoDate(b.sales_end),
      max_per_order: Number(b.max_per_order),
    };
    await api(
      l.id ? "/admin/lots/" + l.id : "/admin/events/" + e.id + "/lots",
      { method: l.id ? "PUT" : "POST", body: data },
    );
    closeModal();
    await loadStore();
    await adminRoute("event", e.id);
  });
}
function resetPage(token) {
  page(
    block(
      "Criar uma nova senha",
      `<form id="reset-form" class="panel stack narrow">${field("password", "Nova senha (mínimo de 12 caracteres)", "", 'type="password" minlength="12" maxlength="128" required autocomplete="new-password"')}${errSlot}<button class="primary" type="submit">Salvar nova senha</button></form>`,
    ),
  );
  bindForm("#reset-form", async (b) => {
    await api("/auth/reset", { method: "POST", body: { ...b, token } });
    await refreshSession();
    toast("Senha atualizada. Entre novamente.");
    location.hash = "account";
  });
}
async function loadStore() {
  [store, events] = await Promise.all([api("/store"), api("/events")]);
  if (store.local_easy && !document.querySelector("#easy-panel-link")) {
    const link = document.createElement("a");
    link.id = "easy-panel-link";
    link.href = "/iniciar";
    link.textContent = "Painel inicial / encerrar o programa";
    document.querySelector("footer > div:nth-child(2)").append(link);
  }
  document.title = store.settings.name + " — Ingressos online";
  $("#brand-name").textContent = store.settings.name;
  $("#footer-tagline").textContent = store.settings.tagline;
  $("#footer-contact").textContent = store.settings.contact;
  document.documentElement.style.setProperty("--accent", store.settings.accent);
  $(".brand-mark").innerHTML = store.settings.logo_url
    ? `<img src="${esc(safeImage(store.settings.logo_url))}" alt="">`
    : '<svg class="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 18L18 6M6 6h12v12"/></svg>';
  $("#environment").textContent =
    store.payment.mode === "disabled"
      ? "AMBIENTE DE VALIDAÇÃO · PAGAMENTO NÃO CONFIGURADO"
      : store.payment.mode === "test"
        ? "AMBIENTE DE TESTE · NÃO UTILIZE PAGAMENTO REAL"
        : events.some((e) => e.demo)
          ? "ATENÇÃO · HÁ EVENTOS DEMONSTRATIVOS NO CATÁLOGO"
          : "INGRESSOS ONLINE · SUA PRÓXIMA EXPERIÊNCIA COMEÇA AQUI";
}
async function route() {
  try {
    const h = location.hash.slice(1) || "home",
      [section, id, extra] = h.split("?")[0].split("/");
    if (h.startsWith("reset=")) return resetPage(h.slice(6));
    if (section === "home") home();
    else if (section === "catalog") catalogPage();
    else if (section === "event") eventPage(id);
    else if (section === "cart") cartPage();
    else if (section === "checkout") checkoutPage();
    else if (section === "account") await accountPage();
    else if (section === "order") await orderPage(id);
    else if (section === "admin") await adminRoute(id, extra);
    else home();
  } catch (e) {
    page(
      block(
        "Não foi possível carregar",
        `<p class="error">${esc(e.message)}</p><button class="chip" id="retry-page">Tentar novamente</button><a class="back" href="#home">Voltar ao início</a>`,
      ),
    );
    buttonAction("#retry-page", async () => {
      await refreshSession();
      await loadStore();
      await route();
    });
  }
}
window.addEventListener("hashchange", () => {
  closeModal();
  route();
  window.scrollTo(0, 0);
});
(async () => {
  try {
    await Promise.all([refreshSession(), loadStore()]);
    saveCart();
    const id = new URLSearchParams(location.search).get("order");
    if (id && /^[a-f0-9-]{36}$/.test(id)) {
      history.replaceState(null, "", "/#order/" + id);
    }
    await route();
  } catch (e) {
    page(
      block(
        "Conexão indisponível",
        `<p>${esc(e.message)}</p><p>Confira se o servidor e o banco de dados estão em execução.</p><button class="primary" id="reload">Tentar novamente</button>`,
      ),
    );
    buttonAction("#reload", () => location.reload());
  }
})();
