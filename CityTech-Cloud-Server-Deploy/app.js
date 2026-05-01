const STORAGE_KEY = "regional-payment-ledger-v1";
const SERVER_URL_KEY = "regional-payment-ledger-server-url";

const sampleData = {
  users: [
    { id: "admin-user", username: "admin", password: "admin123", role: "admin", restricted: false },
    { id: "staff-user", username: "staff", password: "staff123", role: "staff", restricted: false },
  ],
  regions: [
    {
      id: uid(),
      name: "North Region",
      customers: [
        { id: uid(), name: "Apex Traders" },
        { id: uid(), name: "Bright Foods" },
      ],
    },
    {
      id: uid(),
      name: "South Region",
      customers: [
        { id: uid(), name: "Crown Market" },
        { id: uid(), name: "Delta Supplies" },
      ],
    },
  ],
  transactions: [],
};

let state = loadState();
let serverBaseUrl = normalizeServerUrl(localStorage.getItem(SERVER_URL_KEY) || "");
let currentUser = null;

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("./sw.js");
}

const els = {
  loginView: document.querySelector("#loginView"),
  staffView: document.querySelector("#staffView"),
  adminView: document.querySelector("#adminView"),
  loginForm: document.querySelector("#loginForm"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  loginError: document.querySelector("#loginError"),
  serverUrl: document.querySelector("#serverUrl"),
  saveServer: document.querySelector("#saveServer"),
  scanQr: document.querySelector("#scanQr"),
  serverStatus: document.querySelector("#serverStatus"),
  qrConnectBox: document.querySelector("#qrConnectBox"),
  qrCode: document.querySelector("#qrCode"),
  qrUrl: document.querySelector("#qrUrl"),
  paymentForm: document.querySelector("#paymentForm"),
  staffRegion: document.querySelector("#staffRegion"),
  staffCustomer: document.querySelector("#staffCustomer"),
  paymentDate: document.querySelector("#paymentDate"),
  amount: document.querySelector("#amount"),
  notes: document.querySelector("#notes"),
  paymentMessage: document.querySelector("#paymentMessage"),
  staffTransactions: document.querySelector("#staffTransactions"),
  staffTotal: document.querySelector("#staffTotal"),
  regionForm: document.querySelector("#regionForm"),
  newRegion: document.querySelector("#newRegion"),
  regionList: document.querySelector("#regionList"),
  customerForm: document.querySelector("#customerForm"),
  adminRegion: document.querySelector("#adminRegion"),
  newCustomer: document.querySelector("#newCustomer"),
  customerList: document.querySelector("#customerList"),
  customerImportFile: document.querySelector("#customerImportFile"),
  importCustomers: document.querySelector("#importCustomers"),
  importMessage: document.querySelector("#importMessage"),
  userForm: document.querySelector("#userForm"),
  newUsername: document.querySelector("#newUsername"),
  newUserPassword: document.querySelector("#newUserPassword"),
  newUserRole: document.querySelector("#newUserRole"),
  userList: document.querySelector("#userList"),
  filterRegion: document.querySelector("#filterRegion"),
  filterDate: document.querySelector("#filterDate"),
  clearFilters: document.querySelector("#clearFilters"),
  exportExcel: document.querySelector("#exportExcel"),
  adminTransactions: document.querySelector("#adminTransactions"),
  reportTotal: document.querySelector("#reportTotal"),
  cashTotal: document.querySelector("#cashTotal"),
  bankTotal: document.querySelector("#bankTotal"),
  staffSync: document.querySelector("#staffSync"),
  adminSync: document.querySelector("#adminSync"),
};

function loadState() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleData));
    return JSON.parse(JSON.stringify(sampleData));
  }

  try {
    return normalizeState(JSON.parse(stored));
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sampleData));
    return JSON.parse(JSON.stringify(sampleData));
  }
}

function normalizeState(data) {
  return {
    users: Array.isArray(data.users) && data.users.length ? data.users : JSON.parse(JSON.stringify(sampleData.users)),
    regions: Array.isArray(data.regions) ? data.regions : [],
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
  };
}

function uid() {
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeServerUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function applyServerFromUrl() {
  const params = new URLSearchParams(location.search);
  const server = normalizeServerUrl(params.get("server") || "");
  if (!server) return;
  serverBaseUrl = server;
  localStorage.setItem(SERVER_URL_KEY, serverBaseUrl);
  if (els.serverUrl) {
    els.serverUrl.value = serverBaseUrl;
  }
}

function shouldUseServer() {
  return Boolean(serverBaseUrl) || location.protocol !== "file:";
}

function stateApiUrl() {
  return serverBaseUrl ? `${serverBaseUrl}/api/state` : "./api/state";
}

function setServerStatus(message, isError = false) {
  els.serverStatus.textContent = message;
  els.serverStatus.className = isError ? "error" : "hint";
}

function connectToServer(server) {
  serverBaseUrl = normalizeServerUrl(server);
  if (serverBaseUrl) {
    localStorage.setItem(SERVER_URL_KEY, serverBaseUrl);
  } else {
    localStorage.removeItem(SERVER_URL_KEY);
  }
  els.serverUrl.value = serverBaseUrl;
  setServerStatus(serverBaseUrl ? "Connecting..." : "Using this device only.");
  return loadServerState();
}

window.cityTechApplyQrServer = (server) => {
  connectToServer(server);
};

async function loadQrConnect() {
  if (!els.qrConnectBox) return;
  els.qrConnectBox.classList.remove("hidden");
  if (location.protocol === "file:") {
    els.qrUrl.textContent = "Run OPEN-CITY-TECH-DESKTOP.cmd to show the connection QR.";
    return;
  }

  let serverUrl = location.origin;
  renderQr(serverUrl);
  try {
    const response = await fetch("./api/server-info", { cache: "no-store" });
    if (response.ok) {
      const info = await response.json();
      serverUrl = info.urls?.find((url) => !url.includes("localhost")) || info.urls?.[0] || serverUrl;
      renderQr(serverUrl);
    }
  } catch {
    serverUrl = location.origin;
  }
}

function renderQr(serverUrl) {
  try {
    if (!window.QRCode) {
      els.qrUrl.textContent = serverUrl;
      return;
    }
    const deepLink = `citytech://connect?server=${encodeURIComponent(serverUrl)}`;
    els.qrCode.innerHTML = "";
    new QRCode(els.qrCode, {
      text: deepLink,
      width: 180,
      height: 180,
      colorDark: "#17211f",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M,
    });
    els.qrUrl.textContent = serverUrl;
    els.qrConnectBox.classList.remove("hidden");
  } catch {
    els.qrUrl.textContent = serverUrl;
    els.qrConnectBox.classList.remove("hidden");
  }
}

async function loadServerState() {
  if (!shouldUseServer()) return;
  try {
    const response = await fetch(stateApiUrl(), { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load server data");
    state = normalizeState(await response.json());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshAll();
    setServerStatus(serverBaseUrl ? `Connected to ${serverBaseUrl}` : "Using shared server.");
  } catch (error) {
    setServerStatus(`Server not connected. ${error.message}`, true);
    console.warn("Using browser storage because server data could not be loaded.");
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (shouldUseServer()) {
    fetch(stateApiUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    })
      .then((response) => {
        if (!response.ok) throw new Error("Server save failed");
        return response.json();
      })
      .then((serverState) => {
        state = normalizeState(serverState);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        refreshAll();
        setServerStatus(serverBaseUrl ? `Synced with ${serverBaseUrl}` : "Synced with shared server.");
      })
      .catch((error) => {
        setServerStatus(`${error.message}. Saved on this device only.`, true);
        console.warn("Server save failed. Browser copy is still saved.");
      });
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function findRegion(regionId) {
  return state.regions.find((region) => region.id === regionId);
}

function findCustomer(regionId, customerId) {
  return findRegion(regionId)?.customers.find((customer) => customer.id === customerId);
}

function setView(view) {
  [els.loginView, els.staffView, els.adminView].forEach((section) => section.classList.add("hidden"));
  view.classList.remove("hidden");
}

function fillSelect(select, options, placeholder = "Select") {
  const currentValue = select.value;
  select.innerHTML = "";
  if (placeholder) {
    select.add(new Option(placeholder, ""));
  }
  options.forEach((option) => select.add(new Option(option.name, option.id)));
  if (options.some((option) => option.id === currentValue)) {
    select.value = currentValue;
  }
}

function refreshRegionSelectors() {
  fillSelect(els.staffRegion, state.regions, "Select region");
  fillSelect(els.adminRegion, state.regions, "Select region");
  fillSelect(els.filterRegion, state.regions, "All regions");
  refreshStaffCustomers();
  refreshCustomerList();
}

function refreshStaffCustomers() {
  const region = findRegion(els.staffRegion.value);
  fillSelect(els.staffCustomer, region?.customers ?? [], region ? "Select customer" : "Select region first");
}

function refreshCustomerList() {
  const region = findRegion(els.adminRegion.value) ?? state.regions[0];
  if (region && !els.adminRegion.value) {
    els.adminRegion.value = region.id;
  }
  const customers = region?.customers ?? [];
  els.customerList.innerHTML = customers.length
    ? customers.map((customer) => `<li><span>${escapeHtml(customer.name)}</span><small>${escapeHtml(region.name)}</small></li>`).join("")
    : `<li><span>No customers yet</span><small>Add one above</small></li>`;
}

function refreshRegionList() {
  els.regionList.innerHTML = state.regions.length
    ? state.regions
        .map((region) => `<li><span>${escapeHtml(region.name)}</span><small>${region.customers.length} customer(s)</small></li>`)
        .join("")
    : `<li><span>No regions yet</span><small>Add one above</small></li>`;
}

function refreshUserList() {
  els.userList.innerHTML = state.users
    .map((user) => {
      const protectedUser = user.username === "admin";
      return `
        <li>
          <span>
            ${escapeHtml(user.username)}
            <span class="badge">${escapeHtml(user.role)}</span>
            ${user.restricted ? `<span class="badge blocked">Restricted</span>` : ""}
          </span>
          <span class="user-actions">
            <button class="secondary" type="button" data-user-action="toggle" data-user-id="${escapeHtml(user.id)}">
              ${user.restricted ? "Unrestrict" : "Restrict"}
            </button>
            <button class="secondary" type="button" data-user-action="delete" data-user-id="${escapeHtml(user.id)}" ${protectedUser ? "disabled" : ""}>Delete</button>
          </span>
        </li>
      `;
    })
    .join("");
}

function transactionRows(transactions, emptyText, includeNotes = false) {
  if (!transactions.length) {
    const colspan = includeNotes ? 6 : 5;
    return `<tr><td class="empty-row" colspan="${colspan}">${emptyText}</td></tr>`;
  }

  return transactions
    .map((transaction) => {
      const notesCell = includeNotes ? `<td>${escapeHtml(transaction.notes || "-")}</td>` : "";
      return `
        <tr>
          <td>${escapeHtml(transaction.date)}</td>
          <td>${escapeHtml(transaction.regionName)}</td>
          <td>${escapeHtml(transaction.customerName)}</td>
          <td>${escapeHtml(transaction.method)}</td>
          ${notesCell}
          <td class="numeric">${formatMoney(transaction.amount)}</td>
        </tr>
      `;
    })
    .join("");
}

function getFilteredTransactions() {
  return state.transactions
    .filter((transaction) => !els.filterRegion.value || transaction.regionId === els.filterRegion.value)
    .filter((transaction) => !els.filterDate.value || transaction.date === els.filterDate.value)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

function refreshTransactions() {
  const recent = [...state.transactions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10);
  const staffTotal = recent.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  els.staffTransactions.innerHTML = transactionRows(recent, "No transactions recorded yet.");
  els.staffTotal.textContent = formatMoney(staffTotal);

  const filtered = getFilteredTransactions();
  const totals = filtered.reduce(
    (result, transaction) => {
      result.all += Number(transaction.amount);
      result[transaction.method.toLowerCase()] += Number(transaction.amount);
      return result;
    },
    { all: 0, cash: 0, bank: 0 },
  );
  els.adminTransactions.innerHTML = transactionRows(filtered, "No transactions match this report.", true);
  els.reportTotal.textContent = formatMoney(totals.all);
  els.cashTotal.textContent = formatMoney(totals.cash);
  els.bankTotal.textContent = formatMoney(totals.bank);
}

function refreshAll() {
  refreshRegionSelectors();
  refreshRegionList();
  refreshUserList();
  refreshTransactions();
}

function login(user) {
  currentUser = user;
  els.username.value = "";
  els.password.value = "";
  els.loginError.textContent = "";
  if (user.role === "staff") {
    els.paymentDate.value = today();
    refreshAll();
    setView(els.staffView);
  } else {
    refreshAll();
    setView(els.adminView);
  }
}

function addTransaction(event) {
  event.preventDefault();
  const region = findRegion(els.staffRegion.value);
  const customer = findCustomer(els.staffRegion.value, els.staffCustomer.value);
  const amount = Number(els.amount.value);

  if (!region || !customer || !els.paymentDate.value || amount <= 0) {
    els.paymentMessage.textContent = "Select region, customer, date, and a valid amount.";
    return;
  }

  const transaction = {
    id: uid(),
    date: els.paymentDate.value,
    regionId: region.id,
    regionName: region.name,
    customerId: customer.id,
    customerName: customer.name,
    method: document.querySelector("input[name='method']:checked").value,
    amount,
    notes: els.notes.value.trim(),
    createdAt: new Date().toISOString(),
  };

  state.transactions.push(transaction);
  saveState();
  els.paymentForm.reset();
  els.paymentDate.value = today();
  refreshAll();
  els.paymentMessage.textContent = "Transaction saved.";
}

function addRegion(event) {
  event.preventDefault();
  const name = els.newRegion.value.trim();
  const exists = state.regions.some((region) => region.name.toLowerCase() === name.toLowerCase());
  if (!name || exists) return;

  state.regions.push({ id: uid(), name, customers: [] });
  saveState();
  els.regionForm.reset();
  refreshAll();
}

function addCustomer(event) {
  event.preventDefault();
  const region = findRegion(els.adminRegion.value);
  const name = els.newCustomer.value.trim();
  if (!region || !name) return;

  const exists = region.customers.some((customer) => customer.name.toLowerCase() === name.toLowerCase());
  if (exists) return;

  region.customers.push({ id: uid(), name });
  saveState();
  els.customerForm.reset();
  els.adminRegion.value = region.id;
  refreshAll();
}

function addUser(event) {
  event.preventDefault();
  const username = els.newUsername.value.trim();
  const password = els.newUserPassword.value;
  const role = els.newUserRole.value;
  if (!username || !password || !role) return;
  const exists = state.users.some((user) => user.username.toLowerCase() === username.toLowerCase());
  if (exists) {
    els.newUsername.setCustomValidity("User already exists");
    els.newUsername.reportValidity();
    els.newUsername.setCustomValidity("");
    return;
  }
  state.users.push({ id: uid(), username, password, role, restricted: false });
  saveState();
  els.userForm.reset();
  refreshAll();
}

function handleUserListClick(event) {
  const button = event.target.closest("button[data-user-action]");
  if (!button) return;
  const user = state.users.find((item) => item.id === button.dataset.userId);
  if (!user || user.username === "admin" && button.dataset.userAction === "delete") return;
  if (button.dataset.userAction === "toggle") {
    user.restricted = !user.restricted;
  }
  if (button.dataset.userAction === "delete") {
    state.users = state.users.filter((item) => item.id !== user.id);
  }
  saveState();
  refreshAll();
}

async function importCustomers() {
  const region = findRegion(els.adminRegion.value);
  const file = els.customerImportFile.files[0];
  if (!region || !file) {
    els.importMessage.textContent = "Select a region and Excel file.";
    return;
  }
  if (!shouldUseServer()) {
    els.importMessage.textContent = "Connect to shared server before importing Excel.";
    return;
  }

  const formData = new FormData();
  formData.append("regionId", region.id);
  formData.append("file", file);
  els.importMessage.textContent = "Importing...";
  try {
    const response = await fetch(`${serverBaseUrl ? serverBaseUrl : ""}/api/import-customers`, {
      method: "POST",
      body: formData,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed");
    state = normalizeState(result.state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshAll();
    els.importMessage.textContent = `Imported ${result.added} customer(s).`;
  } catch (error) {
    els.importMessage.textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const chars = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return chars[char];
  });
}

function exportExcel() {
  const transactions = getFilteredTransactions();
  const headingRegion = els.filterRegion.value ? findRegion(els.filterRegion.value)?.name : "All Regions";
  const headingDate = els.filterDate.value || "All Dates";
  const total = transactions.reduce((sum, transaction) => sum + Number(transaction.amount), 0);

  const rows = transactions
    .map(
      (transaction, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(transaction.date)}</td>
        <td>${escapeHtml(transaction.regionName)}</td>
        <td>${escapeHtml(transaction.customerName)}</td>
        <td>${escapeHtml(transaction.method)}</td>
        <td>${escapeHtml(transaction.notes || "")}</td>
        <td>${Number(transaction.amount).toFixed(2)}</td>
      </tr>
    `,
    )
    .join("");

  const workbook = `
    <html>
      <head><meta charset="UTF-8"></head>
      <body>
        <table>
          <tr><th colspan="7">General Entry Collective Report</th></tr>
          <tr><td colspan="7">Region: ${escapeHtml(headingRegion || "All Regions")}</td></tr>
          <tr><td colspan="7">Date: ${escapeHtml(headingDate)}</td></tr>
          <tr></tr>
          <tr>
            <th>S/N</th>
            <th>Date</th>
            <th>Region</th>
            <th>Customer</th>
            <th>Payment Method</th>
            <th>Notes</th>
            <th>Amount</th>
          </tr>
          ${rows || `<tr><td colspan="7">No transactions found</td></tr>`}
          <tr>
            <td colspan="6"><strong>Total</strong></td>
            <td><strong>${total.toFixed(2)}</strong></td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel" });
  const link = document.createElement("a");
  const safeRegion = (headingRegion || "all-regions").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const safeDate = (els.filterDate.value || "all-dates").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  link.href = URL.createObjectURL(blob);
  link.download = `general-entry-${safeRegion}-${safeDate}.xls`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

els.loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = els.username.value.trim().toLowerCase();
  const user = state.users.find((item) => item.username.toLowerCase() === username);
  if (!user || els.password.value !== user.password) {
    els.loginError.textContent = "Incorrect user name or password.";
    return;
  }
  if (user.restricted) {
    els.loginError.textContent = "This account is restricted.";
    return;
  }
  login(user);
});

els.saveServer.addEventListener("click", async () => {
  await connectToServer(els.serverUrl.value);
});

els.scanQr.addEventListener("click", () => {
  if (window.CityTechAndroid?.scanQr) {
    window.CityTechAndroid.scanQr();
  }
});

document.querySelectorAll("[data-action='logout']").forEach((button) => {
  button.addEventListener("click", () => setView(els.loginView));
});

els.staffRegion.addEventListener("change", refreshStaffCustomers);
els.paymentForm.addEventListener("submit", addTransaction);
els.regionForm.addEventListener("submit", addRegion);
els.customerForm.addEventListener("submit", addCustomer);
els.userForm.addEventListener("submit", addUser);
els.userList.addEventListener("click", handleUserListClick);
els.importCustomers.addEventListener("click", importCustomers);
els.adminRegion.addEventListener("change", refreshCustomerList);
els.filterRegion.addEventListener("change", refreshTransactions);
els.filterDate.addEventListener("change", refreshTransactions);
els.clearFilters.addEventListener("click", () => {
  els.filterRegion.value = "";
  els.filterDate.value = "";
  refreshTransactions();
});
els.exportExcel.addEventListener("click", exportExcel);
els.staffSync.addEventListener("click", loadServerState);
els.adminSync.addEventListener("click", loadServerState);

applyServerFromUrl();
if (window.CityTechAndroid?.scanQr) {
  els.scanQr.classList.remove("hidden");
}
els.serverUrl.value = serverBaseUrl;
setServerStatus(serverBaseUrl ? `Server saved: ${serverBaseUrl}` : "Leave blank for this device only.");
els.paymentDate.value = today();
refreshAll();
loadServerState();
loadQrConnect();
