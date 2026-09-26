const statusEl = document.querySelector("#status");
const authEl = document.querySelector("#auth");
const form = document.querySelector("#login");
const passcodeInput = document.querySelector("#passcode");
const logoutButton = document.querySelector("#logout");

function line(label, value, state) {
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value;
  if (state) dd.className = state;
  return [dt, dd];
}

function renderMeta(meta) {
  statusEl.replaceChildren();
  const list = document.createElement("dl");
  const rows = [
    ["Mode", meta.deploymentMode ?? "unknown", null],
    ["Database", meta.database ?? "unknown", meta.database === "ok" ? "ok" : "bad"],
    ["Role", meta.role ?? "server", null],
    ["Tenancy", meta.multiTenant ? "multi-tenant" : "single-tenant (v0)", null],
    ["Billing", meta.billing ?? "n/a", null],
  ];
  for (const [label, value, state] of rows) {
    list.append(...line(label, String(value), state));
  }
  const providers = meta.providers ?? {};
  const enabled = Object.entries(providers)
    .filter(([, on]) => on)
    .map(([name]) => name);
  list.append(...line("Providers", enabled.length ? enabled.join(", ") : "none configured", null));
  statusEl.append(list);
}

async function refresh() {
  const response = await fetch("/api/meta");
  if (!response.ok) throw new Error(`meta ${response.status}`);
  renderMeta(await response.json());
  const me = await fetch("/api/me");
  if (me.ok) {
    authEl.textContent = "Session unlocked for this browser.";
    logoutButton.hidden = false;
  } else {
    authEl.textContent = "";
    logoutButton.hidden = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  authEl.textContent = "Checking passcode…";
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode: passcodeInput.value }),
  });
  passcodeInput.value = "";
  if (response.status === 429) {
    authEl.textContent = "Too many attempts. Wait and try again.";
    return;
  }
  if (!response.ok) {
    authEl.textContent = "Passcode rejected.";
    logoutButton.hidden = true;
    return;
  }
  await refresh();
});

logoutButton.addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" });
  await refresh();
});

refresh().catch(() => {
  statusEl.textContent = "The API is not reachable through this origin.";
});
