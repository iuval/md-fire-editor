/* UI de FireMD Sync. Habla con el backend por los comandos de Tauri. */

const invoke = window.__TAURI__?.core?.invoke;
const el = (id) => document.getElementById(id);

/** Error de la última acción del usuario (pisa el error del motor hasta que salga bien). */
let actionError = null;
let status = null;

function setText(id, text) {
  const node = el(id);
  if (node && node.textContent !== text) node.textContent = text;
}

function setHidden(id, hidden) {
  const node = el(id);
  if (node && node.hidden !== hidden) node.hidden = hidden;
}

function setPill(text, state) {
  const pill = el("pill");
  if (pill.textContent !== text) pill.textContent = text;
  if (pill.dataset.state !== state) pill.dataset.state = state;
}

function formatTime(milliseconds) {
  if (!milliseconds) return "Todavía no sincronizó";
  const date = new Date(milliseconds);
  const time = date.toLocaleTimeString("es", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `Última sincronización: ${time}`;
}

function render(next) {
  status = next;

  if (waitingForBrowser) setPill("Esperando el navegador…", "busy");
  else if (!next.logged_in) setPill("Sin cuenta", "error");
  else if (next.syncing) setPill("Sincronizando…", "busy");
  else if (next.last_error) setPill("Error", "error");
  else if (!next.vault) setPill("Sin carpeta", "error");
  else setPill("Al día", "ok");

  const account = Boolean(next.account);
  setHidden("account-out", next.logged_in);
  setHidden("account-in", !next.logged_in);
  setHidden("agent-block", account);
  setHidden("account-email", !account);
  setText(
    "account-state",
    next.logged_in ? (account ? "Cuenta conectada" : "Agente conectado") : "Sin cuenta"
  );
  setText("account-email", account && next.email ? `Conectada como ${next.email}` : "");
  setText("uid", next.uid ?? "");

  const vaultPath = el("vault-path");
  vaultPath.textContent = next.vault ?? "Ninguna carpeta elegida";
  vaultPath.classList.toggle("empty", !next.vault);
  el("reveal").disabled = !next.vault;

  const auto = el("auto");
  if (auto.checked !== next.auto) auto.checked = next.auto;
  const interval = el("interval");
  if (interval.value !== String(next.interval_secs)) interval.value = String(next.interval_secs);

  setText("sync-state", next.syncing ? "Sincronizando…" : next.auto ? "Automática" : "Manual");
  setText("last-sync", formatTime(next.last_sync));

  const report = next.last_report;
  const push = report?.push ?? {};
  setText("count-pulled", String(report?.pull?.written ?? 0));
  setText("count-pushed", String(push.updated ?? 0));
  setText("count-created", String(push.created?.length ?? 0));
  setText("count-conflicts", String(push.conflicts?.length ?? 0));

  const conflicts = el("conflicts");
  const items = push.conflicts ?? [];
  conflicts.replaceChildren(
    ...items.map((conflict) => {
      const item = document.createElement("li");
      item.textContent = conflict.conflict;
      return item;
    })
  );
  setHidden("conflicts", items.length === 0);

  const message = actionError ?? next.last_error;
  setHidden("error", !message);
  if (message) setText("error", message);
}

async function refresh() {
  try {
    render(await invoke("status"));
  } catch (error) {
    setPill("Sin conexión con el motor", "error");
    setText("error", String(error));
    setHidden("error", false);
  }
}

async function run(action) {
  try {
    const result = await action();
    actionError = null;
    await refresh();
    return result;
  } catch (error) {
    actionError = typeof error === "string" ? error : (error?.message ?? String(error));
    setHidden("error", false);
    setText("error", actionError);
    setPill("Error", "error");
    return null;
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

el("login").addEventListener("click", () =>
  run(async () => {
    const info = await invoke("login");
    actionError = null;
    return info;
  })
);

/**
 * Login con la cuenta del sitio: el backend abre el navegador y espera el
 * handshake en un puerto local. Mientras tanto el botón queda bloqueado y el
 * estado dice que el turno es del navegador.
 */
el("login-account").addEventListener("click", async () => {
  const button = el("login-account");
  if (button.disabled) return;
  button.disabled = true;
  waitingForBrowser = true;
  setPill("Esperando el navegador…", "busy");
  try {
    await run(() => invoke("login_account"));
  } finally {
    waitingForBrowser = false;
    button.disabled = false;
    await refresh();
  }
});

el("logout").addEventListener("click", () => run(() => invoke("logout")));

el("copy").addEventListener("click", async () => {
  const uid = status?.uid;
  if (!uid) return;
  const copied = await copyText(uid);
  const button = el("copy");
  button.textContent = copied ? "Copiado" : "No se pudo copiar";
  setTimeout(() => {
    button.textContent = "Copiar uid";
  }, 1600);
});

el("pick").addEventListener("click", () =>
  run(async () => {
    const dir = await invoke("pick_folder");
    if (dir) await invoke("set_vault", { dir });
  })
);

el("reveal").addEventListener("click", () => {
  if (status?.vault) run(() => invoke("open_folder", { path: status.vault }));
});

el("sync").addEventListener("click", () => run(() => invoke("sync_now")));

el("auto").addEventListener("change", (event) =>
  run(() => invoke("set_auto", { auto: event.target.checked }))
);

el("interval").addEventListener("change", (event) =>
  run(() => invoke("set_interval", { seconds: Number(event.target.value) }))
);

invoke("app_info")
  .then((info) => setText("version", `v${info.version}`))
  .catch(() => {});

refresh();
setInterval(refresh, 1000);
