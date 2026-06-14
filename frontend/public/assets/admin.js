const state = {
  token: localStorage.getItem("egAdminToken"),
  user: null,
  socket: null,
  employees: [],
  clients: [],
  materials: [],
  teams: [],
  services: [],
  serviceMaterials: [],
  dashboard: null,
  editingServiceId: null,
  editingClientId: null,
  editingMaterialId: null,
  editingTeamId: null,
  activeTab: "dashboard"
};

const statusLabels = {
  scheduled: "Agendado",
  in_progress: "Iniciado",
  done: "Finalizado",
  cancelled: "Cancelado"
};

const trackingStatuses = [
  { id: "scheduled", title: "Agendados", icon: "calendar-clock" },
  { id: "in_progress", title: "Iniciados", icon: "play-circle" },
  { id: "cancelled", title: "Cancelados", icon: "x-circle" },
  { id: "done", title: "Finalizados", icon: "check-circle-2" }
];

const pageText = {
  dashboard: ["Painel", "Visão geral dos serviços em andamento."],
  clients: ["Clientes", "Cadastre e organize os clientes atendidos."],
  materials: ["Materiais", "Cadastre peças e códigos para montar romaneios."],
  teams: ["Equipes", "Monte equipes, líderes e envios coletivos."],
  services: ["Serviços", "Cadastre, envie e acompanhe a agenda da equipe."],
  employees: ["Funcionários", "Gerencie quem recebe os serviços."]
};

pageText.tracking = ["Acompanhamento", "Servicos separados por agendados, iniciados, cancelados e finalizados."];
pageText.settings = ["Configurações", "Atualize o acesso do administrador e a conexão."];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function refreshIcons() {
  window.EGIcons?.refresh();
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function formatQuantity(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toLocaleString("pt-BR");
}

function formatDateTime(service) {
  if (!service.date) return "Sem data";
  const value = new Date(`${service.date}T${service.time || "00:00"}:00`);
  if (Number.isNaN(value.getTime())) return `${service.date} ${service.time || ""}`.trim();
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: service.time ? "short" : undefined
  }).format(value);
}

function shortDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatLocation(location) {
  if (!location) return "";
  const accuracy = location.accuracy ? `, precisão aprox. ${location.accuracy}m` : "";
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  if (location.type === "gps" && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}${accuracy}`;
  }
  return location.label || location.mapsUrl || "Localização informada";
}

function toast(title, message, type = "info") {
  const zone = $("#toastZone");
  const node = document.createElement("div");
  node.className = `toast ${type === "error" ? "error" : ""}`;
  node.innerHTML = `<strong>${escapeHTML(title)}</strong><span>${escapeHTML(message)}</span>`;
  zone.appendChild(node);
  window.setTimeout(() => node.remove(), 4600);
}

function browserNotify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(title, {
    body,
    icon: "/assets/logo.svg"
  });
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("Notificações", "Este navegador não suporta notificações.", "error");
    return;
  }
  const permission = await Notification.requestPermission();
  toast("Notificações", permission === "granted" ? "Notificações ativadas." : "Permissão não concedida.");
}

async function api(path, options = {}) {
  if (window.EGRuntime?.requiresServerUrl()) {
    throw new Error("Informe a URL do servidor central antes de entrar.");
  }
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const url = window.EGRuntime?.apiUrl(path) || path;
  const response = await fetch(url, { ...options, headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Erro ao processar solicitacao.");
  }
  return payload;
}

function showLogin() {
  localStorage.removeItem("egAdminToken");
  state.token = null;
  state.user = null;
  if (state.socket) state.socket.disconnect();
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  window.EGRuntime?.fillConnectionForm($("#adminLoginForm"));
  refreshIcons();
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#adminName").textContent = state.user?.name || "Administrador";
  renderSettings();
}

function switchTab(tab) {
  state.activeTab = tab;
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $$(".tab-view").forEach((view) => view.classList.add("hidden"));
  $(`#${tab}Tab`).classList.remove("hidden");
  $("#pageTitle").textContent = pageText[tab][0];
  $("#pageSubtitle").textContent = pageText[tab][1];
  if (tab === "settings") renderSettings();
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  const socketUrl = window.EGRuntime?.socketUrl();
  state.socket = socketUrl ? io(socketUrl, { auth: { token: state.token } }) : io({ auth: { token: state.token } });

  state.socket.on("connect_error", () => {
    toast("Conexao em tempo real", "Nao foi possivel conectar aos avisos.", "error");
  });

  state.socket.on("dashboard:updated", (dashboard) => {
    state.dashboard = dashboard;
    renderDashboard();
  });

  state.socket.on("service:created", ({ service, message }) => {
    upsertService(service);
    renderServices();
    toast("Serviço enviado", message || `${service.code} criado.`);
    browserNotify("EG Automações Services", message || `${service.code} criado.`);
  });

  state.socket.on("service:updated", ({ service, message }) => {
    upsertService(service);
    renderServices();
    toast("Serviço atualizado", message || `${service.code} atualizado.`);
    browserNotify("EG Automações Services", message || `${service.code} atualizado.`);
  });

  state.socket.on("employee:updated", async ({ message }) => {
    await loadEmployees();
    toast("Equipe", message || "Funcionário atualizado.");
  });

  state.socket.on("client:updated", async ({ message }) => {
    await loadClients();
    toast("Clientes", message || "Cliente atualizado.");
  });

  state.socket.on("material:updated", async ({ message }) => {
    await loadMaterials();
    toast("Materiais", message || "Material atualizado.");
  });

  state.socket.on("team:updated", async ({ message }) => {
    await loadTeams();
    toast("Equipes", message || "Equipe atualizada.");
  });
}

function upsertService(service) {
  const index = state.services.findIndex((item) => item.id === service.id);
  if (index >= 0) state.services[index] = service;
  else state.services.unshift(service);
}

async function loadMe() {
  const { user } = await api("/api/me");
  state.user = user;
  renderSettings();
}

async function loadDashboard() {
  state.dashboard = await api("/api/dashboard");
  renderDashboard();
}

async function loadEmployees() {
  state.employees = await api("/api/employees");
  renderEmployeeCheckboxes();
  renderTeamLeaderSelect();
  renderTeamEmployeeCheckboxes();
  renderEmployees();
  renderTeams();
}

async function loadClients() {
  state.clients = await api("/api/clients");
  renderClientSelect();
  renderClientFilter();
  renderClients();
}

async function loadMaterials() {
  state.materials = await api("/api/materials");
  renderMaterials();
  renderMaterialPreview();
}

async function loadTeams() {
  state.teams = await api("/api/teams");
  renderTeamSelect();
  renderTeamFilter();
  renderEmployeeCheckboxes();
  renderTeams();
  renderTeamEmployeeCheckboxes();
}

async function loadServices() {
  state.services = await api("/api/services");
  renderServices();
}

async function loadAll() {
  await Promise.all([loadDashboard(), loadEmployees(), loadClients(), loadMaterials(), loadTeams(), loadServices()]);
}

function renderDashboard() {
  const dashboard = state.dashboard || {};
  const stats = [
    ["Total", dashboard.total || 0],
    ["Agendados", dashboard.scheduled || 0],
    ["Iniciados", dashboard.inProgress || 0],
    ["Finalizados", dashboard.done || 0],
    ["Clientes", dashboard.clients || 0],
    ["Materiais", dashboard.materials || 0],
    ["Equipes", dashboard.teams || 0],
    ["Equipe ativa", dashboard.activeEmployees || 0]
  ];

  $("#statsGrid").innerHTML = stats
    .map(([label, value]) => `<section class="stat"><span>${label}</span><strong>${value}</strong></section>`)
    .join("");

  const events = dashboard.recentEvents || [];
  $("#activityList").innerHTML = events.length
    ? events
        .map(
          (event) => `
            <div class="activity-row">
              <div>
                <strong>${escapeHTML(event.message)}</strong>
                <span>${shortDate(event.createdAt)}</span>
              </div>
              <span class="badge scheduled">${escapeHTML(event.type)}</span>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nenhuma atividade registrada ainda.</div>`;
  refreshIcons();
}

function renderSettings() {
  const form = $("#adminSettingsForm");
  if (form && state.user) {
    form.elements.name.value = state.user.name || "";
    form.elements.email.value = state.user.email || "";
  }
  const server = $("#settingsServerUrl");
  if (server) {
    server.textContent = window.EGRuntime?.getServerUrl?.() || "Servidor nao definido";
  }
}

function renderClientSelect() {
  const select = $("#clientSelect");
  if (!select) return;
  const selected = select.value;
  const activeClients = state.clients.filter((client) => client.active);
  select.innerHTML = `
    <option value="">Cliente avulso</option>
    ${activeClients
      .map((client) => `<option value="${escapeHTML(client.id)}">${escapeHTML(client.name)}</option>`)
      .join("")}
  `;
  select.value = activeClients.some((client) => client.id === selected) ? selected : "";
}

function renderClientFilter() {
  const select = $("#clientFilter");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `
    <option value="">Todos os clientes</option>
    ${state.clients
      .map((client) => `<option value="${escapeHTML(client.id)}">${escapeHTML(client.name)}</option>`)
      .join("")}
  `;
  select.value = state.clients.some((client) => client.id === selected) ? selected : "";
}

function renderTeamSelect() {
  const select = $("#teamSelect");
  if (!select) return;
  const selected = select.value;
  const activeTeams = state.teams.filter((team) => team.active);
  select.innerHTML = `
    <option value="">Sem equipe, selecionar manualmente</option>
    ${activeTeams
      .map((team) => `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}${team.leader ? ` · líder: ${escapeHTML(team.leader.name)}` : ""}</option>`)
      .join("")}
  `;
  select.value = activeTeams.some((team) => team.id === selected) ? selected : "";
}

function renderTeamFilter() {
  const select = $("#teamFilter");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `
    <option value="">Todas as equipes</option>
    ${state.teams
      .map((team) => `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}</option>`)
      .join("")}
  `;
  select.value = state.teams.some((team) => team.id === selected) ? selected : "";
}

function renderTeamLeaderSelect() {
  const select = $("#teamLeaderSelect");
  if (!select) return;
  const selected = select.value;
  const activeEmployees = state.employees.filter((employee) => employee.active);
  select.innerHTML = `
    <option value="">Selecione o líder</option>
    ${activeEmployees
      .map((employee) => `<option value="${escapeHTML(employee.id)}">${escapeHTML(employee.name)}</option>`)
      .join("")}
  `;
  select.value = activeEmployees.some((employee) => employee.id === selected) ? selected : "";
}

function renderTeamEmployeeCheckboxes() {
  const container = $("#teamEmployeeCheckboxes");
  if (!container) return;
  const selected = new Set();
  if (state.editingTeamId) {
    const team = state.teams.find((item) => item.id === state.editingTeamId);
    (team?.employeeIds || []).forEach((id) => selected.add(id));
  }

  const activeEmployees = state.employees.filter((employee) => employee.active);
  container.innerHTML = activeEmployees.length
    ? activeEmployees
        .map(
          (employee) => `
            <label class="checkbox-item">
              <input type="checkbox" name="teamEmployeeIds" value="${escapeHTML(employee.id)}" ${selected.has(employee.id) ? "checked" : ""}>
              <span>${escapeHTML(employee.name)}</span>
            </label>
          `
        )
        .join("")
    : `<div class="empty">Cadastre funcionários ativos para montar equipes.</div>`;
}

function renderEmployeeCheckboxes() {
  const container = $("#employeeCheckboxes");
  if (!container) return;
  const selected = new Set();
  const selectedTeam = state.teams.find((team) => team.id === $("#teamSelect")?.value);
  if (selectedTeam) {
    selectedTeam.employeeIds.forEach((id) => selected.add(id));
  }
  if (state.editingServiceId) {
    const service = state.services.find((item) => item.id === state.editingServiceId);
    if (!selectedTeam) (service?.employeeIds || []).forEach((id) => selected.add(id));
  }

  const activeEmployees = state.employees.filter((employee) => employee.active);
  const teamNote = selectedTeam
    ? `<div class="team-selection-note"><strong>Equipe selecionada: ${escapeHTML(selectedTeam.name)}</strong><span>${escapeHTML((selectedTeam.employees || []).map((employee) => employee.name).join(", ") || "Sem membros")}</span></div>`
    : "";
  container.innerHTML = activeEmployees.length
    ? `${teamNote}${activeEmployees
        .map(
          (employee) => `
            <label class="checkbox-item">
              <input type="checkbox" name="employeeIds" value="${escapeHTML(employee.id)}" ${selected.has(employee.id) ? "checked" : ""} ${selectedTeam ? "disabled" : ""}>
              <span>${escapeHTML(employee.name)}</span>
            </label>
          `
        )
        .join("")}`
    : `<div class="empty">Cadastre um funcionário ativo para enviar serviços.</div>`;
}

function locationBlock(title, location) {
  if (!location) return "";
  const mapsLink = location.mapsUrl
    ? `<a class="ghost-button compact-link" href="${escapeHTML(location.mapsUrl)}" target="_blank" rel="noreferrer">Abrir mapa</a>`
    : "";

  return `
    <div class="location-summary">
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(formatLocation(location))}</span>
      <small>${escapeHTML(shortDate(location.capturedAt))}</small>
      ${mapsLink}
    </div>
  `;
}

function materialsBlock(materials = []) {
  if (!materials.length) return "";
  return `
    <div class="materials-summary">
      <strong>Materiais</strong>
      ${materials
        .map(
          (item) => `
            <span>${escapeHTML(item.code)} - ${escapeHTML(item.name)} · ${escapeHTML(formatQuantity(item.quantity))} ${escapeHTML(item.unit || "un")}${item.notes ? ` · ${escapeHTML(item.notes)}` : ""}</span>
          `
        )
        .join("")}
    </div>
  `;
}

function signatureBlock(signature) {
  if (!signature?.imageDataUrl) return "";
  return `
    <div class="signature-summary">
      <div>
        <strong>Assinatura do cliente</strong>
        <span>${escapeHTML(signature.signerName || "Cliente")} · ${escapeHTML(shortDate(signature.signedAt))}</span>
        <span>${escapeHTML(signature.serviceType || "")}</span>
      </div>
      <img src="${escapeHTML(signature.imageDataUrl)}" alt="Assinatura de ${escapeHTML(signature.signerName || "cliente")}">
    </div>
  `;
}

function photoBlock(servicePhotos = {}) {
  const photos = [
    { title: "Foto antes", photo: servicePhotos.before },
    { title: "Foto depois", photo: servicePhotos.after }
  ].filter((item) => item.photo?.imageDataUrl);

  if (!photos.length) return "";

  return `
    <div class="photo-summary">
      <strong>Fotos do servico</strong>
      <div class="photo-grid">
        ${photos
          .map(
            ({ title, photo }) => `
              <figure class="photo-card">
                <img src="${escapeHTML(photo.imageDataUrl)}" alt="${escapeHTML(title)}">
                <figcaption>${escapeHTML(title)} - ${escapeHTML(shortDate(photo.capturedAt))}</figcaption>
              </figure>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function teamBlock(service) {
  if (!service.team) return "";
  const leaderName = service.team.leader?.name || "Sem líder";
  const members = (service.team.employees || []).map((employee) => employee.name).join(", ");
  return `
    <div class="materials-summary team-summary">
      <strong>Equipe: ${escapeHTML(service.team.name)}</strong>
      <span>Líder: ${escapeHTML(leaderName)}</span>
      <span>Companheiros: ${escapeHTML(members || "Nenhum")}</span>
    </div>
  `;
}

function reportMaterialsTable(materials = []) {
  if (!materials.length) return `<p class="muted">Nenhum material informado.</p>`;
  return `
    <table>
      <thead>
        <tr>
          <th>Codigo</th>
          <th>Material</th>
          <th>Qtd.</th>
          <th>Obs.</th>
        </tr>
      </thead>
      <tbody>
        ${materials
          .map(
            (item) => `
              <tr>
                <td>${escapeHTML(item.code || "")}</td>
                <td>${escapeHTML(item.name || "")}</td>
                <td>${escapeHTML(formatQuantity(item.quantity || 1))} ${escapeHTML(item.unit || "un")}</td>
                <td>${escapeHTML(item.notes || "")}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function reportPhotoFigure(title, photo) {
  if (!photo?.imageDataUrl) return `<div class="photo-empty">Sem ${escapeHTML(title.toLowerCase())} registrada.</div>`;
  return `
    <figure>
      <img src="${escapeHTML(photo.imageDataUrl)}" alt="${escapeHTML(title)}">
      <figcaption>${escapeHTML(title)} - ${escapeHTML(shortDate(photo.capturedAt))}</figcaption>
    </figure>
  `;
}

function buildReportHtml(service) {
  const customerName = service.client?.name || service.customer || "Cliente nao informado";
  const clientEmail = service.reportPreference?.clientEmail || service.client?.email || "";
  const employeeNames = (service.employees || []).map((employee) => employee.name).join(", ") || "Sem funcionario";
  const teamName = service.team?.name || "";
  const beforePhoto = service.servicePhotos?.before;
  const afterPhoto = service.servicePhotos?.after;
  const signature = service.clientSignature;

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Relatorio ${escapeHTML(service.code)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 28px; font-family: Arial, sans-serif; color: #17211f; background: #f6f8f7; }
    .report { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #d9e3df; border-radius: 8px; padding: 28px; }
    .actions { position: sticky; top: 0; display: flex; justify-content: flex-end; gap: 10px; margin: -28px -28px 22px; padding: 12px; background: #eef5f1; border-bottom: 1px solid #d9e3df; }
    button { border: 0; border-radius: 8px; padding: 10px 14px; color: #fff; background: #1f7a4d; font-weight: 700; cursor: pointer; }
    header { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #1f7a4d; padding-bottom: 18px; }
    h1 { margin: 0 0 6px; font-size: 26px; }
    h2 { margin: 26px 0 10px; font-size: 16px; color: #1f7a4d; }
    p { margin: 4px 0; line-height: 1.45; }
    .muted { color: #5f6f69; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
    .box { border: 1px solid #d9e3df; border-radius: 8px; padding: 12px; background: #fbfdfc; }
    .box strong { display: block; margin-bottom: 4px; font-size: 12px; color: #5f6f69; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #d9e3df; padding: 9px; text-align: left; vertical-align: top; }
    th { background: #eef5f1; }
    .photos { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    figure { margin: 0; border: 1px solid #d9e3df; border-radius: 8px; padding: 10px; background: #fbfdfc; }
    figure img { display: block; width: 100%; max-height: 420px; object-fit: contain; background: #f1f4f3; border-radius: 6px; }
    figcaption { margin-top: 8px; color: #5f6f69; font-size: 12px; }
    .signature img { max-width: 360px; max-height: 120px; object-fit: contain; border: 1px solid #d9e3df; border-radius: 8px; background: #fff; }
    .photo-empty { border: 1px dashed #b7c7c0; border-radius: 8px; padding: 24px; color: #5f6f69; background: #fbfdfc; }
    @media print {
      body { background: #fff; padding: 0; }
      .report { border: 0; padding: 0; }
      .actions { display: none; }
    }
    @media (max-width: 720px) {
      body { padding: 12px; }
      .report { padding: 18px; }
      .grid, .photos { grid-template-columns: 1fr; }
      header { display: block; }
    }
  </style>
</head>
<body>
  <main class="report">
    <div class="actions">
      <button type="button" onclick="window.print()">Salvar / imprimir PDF</button>
    </div>
    <header>
      <div>
        <h1>Relatorio de servico</h1>
        <p><strong>EG Automacoes Services</strong></p>
        <p class="muted">${escapeHTML(service.code)} - ${escapeHTML(service.title || "")}</p>
      </div>
      <div>
        <p><strong>Status:</strong> ${escapeHTML(statusLabels[service.status] || service.status)}</p>
        <p><strong>Gerado em:</strong> ${escapeHTML(shortDate(new Date().toISOString()))}</p>
      </div>
    </header>

    <section class="grid">
      <div class="box"><strong>Cliente/empresa</strong>${escapeHTML(customerName)}</div>
      <div class="box"><strong>E-mail do cliente</strong>${escapeHTML(clientEmail || "Nao informado")}</div>
      <div class="box"><strong>Data e horario</strong>${escapeHTML(formatDateTime(service))}</div>
      <div class="box"><strong>Local</strong>${escapeHTML(service.location || "")}<br><span class="muted">${escapeHTML(service.address || "")}</span></div>
      <div class="box"><strong>Responsaveis</strong>${escapeHTML(teamName ? `${teamName} - ${employeeNames}` : employeeNames)}</div>
      <div class="box"><strong>Envio ao cliente</strong>${service.reportPreference?.sendToClient ? "Solicitado no encerramento" : "Nao solicitado no encerramento"}</div>
    </section>

    <h2>Descricao</h2>
    <p>${escapeHTML(service.notes || "Sem observacoes.")}</p>

    <h2>Materiais</h2>
    ${reportMaterialsTable(service.materials || [])}

    <h2>Comprovantes de localizacao</h2>
    <section class="grid">
      <div class="box"><strong>Inicio</strong>${escapeHTML(formatLocation(service.startLocation) || "Nao informado")}<br><span class="muted">${escapeHTML(shortDate(service.startLocation?.capturedAt))}</span></div>
      <div class="box"><strong>Final</strong>${escapeHTML(formatLocation(service.finalLocation) || "Nao informado")}<br><span class="muted">${escapeHTML(shortDate(service.finalLocation?.capturedAt))}</span></div>
    </section>

    <h2>Fotos antes e depois</h2>
    <section class="photos">
      ${reportPhotoFigure("Foto antes", beforePhoto)}
      ${reportPhotoFigure("Foto depois", afterPhoto)}
    </section>

    <h2>Assinatura do cliente</h2>
    <section class="signature">
      ${
        signature?.imageDataUrl
          ? `<p>${escapeHTML(signature.signerName || "Cliente")} - ${escapeHTML(shortDate(signature.signedAt))}</p><img src="${escapeHTML(signature.imageDataUrl)}" alt="Assinatura do cliente">`
          : `<p class="muted">Sem assinatura registrada.</p>`
      }
    </section>
  </main>
</body>
</html>`;
}

function openServiceReport(serviceId) {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service) return;
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) {
    toast("Relatorio", "O navegador bloqueou a janela do relatorio.", "error");
    return;
  }
  reportWindow.document.open();
  reportWindow.document.write(buildReportHtml(service));
  reportWindow.document.close();
}

function sendServiceReport(serviceId) {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service) return;
  const email = service.reportPreference?.clientEmail || service.client?.email || "";
  if (!email) {
    toast("Relatorio", "Cadastre o e-mail do cliente para preparar o envio.", "error");
    return;
  }

  openServiceReport(serviceId);
  const customerName = service.client?.name || service.customer || "cliente";
  const subject = `Relatorio ${service.code} - ${customerName}`;
  const body = [
    `Ola, segue o relatorio do servico ${service.code}.`,
    "",
    `Cliente: ${customerName}`,
    `Servico: ${service.title || ""}`,
    `Data: ${formatDateTime(service)}`,
    `Local: ${service.location || ""}`,
    "",
    "O relatorio completo com fotos, materiais, assinatura e localizacoes foi aberto no sistema para salvar em PDF e anexar a este e-mail."
  ].join("\n");
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast("Relatorio", "Relatorio aberto para salvar em PDF e e-mail preparado.");
}

function serviceCard(service) {
  const employeeNames = (service.employees || []).map((employee) => employee.name).join(", ");
  const customerName = service.client?.name || service.customer;
  const canAdminAct = !["done", "cancelled"].includes(service.status);
  const canReport = service.status === "done";

  return `
    <article class="service-card">
      <div class="service-card-header">
        <div>
          <h3>${escapeHTML(service.code)} - ${escapeHTML(service.title)}</h3>
          <div class="meta">
            <span>${formatDateTime(service)}</span>
            <span>${escapeHTML(service.location)}</span>
            <span>${escapeHTML(employeeNames || "Sem funcionário")}</span>
          </div>
        </div>
        <span class="badge ${escapeHTML(service.status)}">${escapeHTML(statusLabels[service.status] || service.status)}</span>
      </div>
      <p class="notes">${escapeHTML(customerName ? `Cliente: ${customerName}` : "")}</p>
      <p class="notes">${escapeHTML(service.address)}</p>
      ${teamBlock(service)}
      ${materialsBlock(service.materials || [])}
      ${service.notes ? `<p class="notes">${escapeHTML(service.notes)}</p>` : ""}
      ${locationBlock("Localização de início", service.startLocation)}
      ${locationBlock("Localização final", service.finalLocation)}
      ${photoBlock(service.servicePhotos)}
      ${signatureBlock(service.clientSignature)}
      ${
        canReport
          ? `<div class="row-actions">
              <button class="ghost-button" type="button" data-action="open-report" data-id="${escapeHTML(service.id)}"><i data-lucide="file-text"></i>Salvar relatorio</button>
              <button class="status-button" type="button" data-action="send-report" data-id="${escapeHTML(service.id)}"><i data-lucide="mail"></i>Enviar ao cliente</button>
            </div>`
          : ""
      }
      ${
        canAdminAct
          ? `<div class="row-actions">
              <button class="ghost-button" type="button" data-action="edit-service" data-id="${escapeHTML(service.id)}"><i data-lucide="pencil"></i>Editar</button>
              <button class="danger-button" type="button" data-action="cancel-service" data-id="${escapeHTML(service.id)}"><i data-lucide="x-circle"></i>Cancelar</button>
            </div>`
          : ""
      }
    </article>
  `;
}

function serviceTrackingCard(service) {
  const employeeNames = (service.employees || []).map((employee) => employee.name).join(", ");
  const customerName = service.client?.name || service.customer || "Cliente nao informado";
  const teamName = service.team?.name ? `Equipe: ${service.team.name}` : "";
  const materialCount = (service.materials || []).length;
  const timestamp =
    service.status === "in_progress"
      ? `Inicio: ${shortDate(service.startedAt)}`
      : service.status === "done"
        ? `Finalizado: ${shortDate(service.finishedAt)}`
        : service.status === "cancelled"
          ? `Cancelado: ${shortDate(service.cancelledAt)}`
          : `Agenda: ${formatDateTime(service)}`;

  return `
    <article class="tracking-card">
      <div class="tracking-card-head">
        <div>
          <strong>${escapeHTML(service.code)} - ${escapeHTML(service.title)}</strong>
          <span>${escapeHTML(customerName)}</span>
        </div>
        <span class="badge ${escapeHTML(service.status)}">${escapeHTML(statusLabels[service.status] || service.status)}</span>
      </div>
      <div class="tracking-card-meta">
        <span><i data-lucide="clock"></i>${escapeHTML(timestamp)}</span>
        <span><i data-lucide="map-pin"></i>${escapeHTML(service.location || "Sem local")}</span>
        <span><i data-lucide="users-round"></i>${escapeHTML(teamName || employeeNames || "Sem responsavel")}</span>
        <span><i data-lucide="package"></i>${materialCount} material(is)</span>
      </div>
    </article>
  `;
}

function sortTrackingServices(status, services) {
  const sorted = services
    .slice()
    .sort((a, b) => `${a.date || ""} ${a.time || ""}`.localeCompare(`${b.date || ""} ${b.time || ""}`));
  return ["done", "cancelled"].includes(status) ? sorted.reverse() : sorted;
}

function renderTracking() {
  const overview = $("#statusOverview");
  const board = $("#statusBoard");
  if (!overview || !board) return;

  const groups = Object.fromEntries(
    trackingStatuses.map((status) => [
      status.id,
      sortTrackingServices(status.id, state.services.filter((service) => service.status === status.id))
    ])
  );

  overview.innerHTML = trackingStatuses
    .map(
      (status) => `
        <section class="tracking-stat ${escapeHTML(status.id)}">
          <span><i data-lucide="${escapeHTML(status.icon)}"></i>${escapeHTML(status.title)}</span>
          <strong>${groups[status.id].length}</strong>
        </section>
      `
    )
    .join("");

  board.innerHTML = trackingStatuses
    .map(
      (status) => `
        <section class="tracking-column">
          <div class="tracking-column-title">
            <div>
              <h2>${escapeHTML(status.title)}</h2>
              <span>${groups[status.id].length} servico(s)</span>
            </div>
            <span class="badge ${escapeHTML(status.id)}">${groups[status.id].length}</span>
          </div>
          <div class="list">
            ${
              groups[status.id].length
                ? groups[status.id].map(serviceTrackingCard).join("")
                : `<div class="empty">Nenhum servico ${escapeHTML(status.title.toLowerCase())}.</div>`
            }
          </div>
        </section>
      `
    )
    .join("");
}

function renderServices() {
  const filter = $("#statusFilter").value;
  const clientId = $("#clientFilter").value;
  const teamId = $("#teamFilter")?.value || "";
  const dateFrom = $("#dateFromFilter").value;
  const dateTo = $("#dateToFilter").value;
  const services = state.services
    .filter((service) => filter === "all" || service.status === filter)
    .filter((service) => !clientId || service.clientId === clientId)
    .filter((service) => !teamId || service.teamId === teamId)
    .filter((service) => !dateFrom || service.date >= dateFrom)
    .filter((service) => !dateTo || service.date <= dateTo)
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

  $("#serviceList").innerHTML = services.length
    ? services.map(serviceCard).join("")
    : `<div class="empty">Nenhum serviço encontrado.</div>`;
  renderTracking();
  refreshIcons();
}

function renderMaterials() {
  $("#materialList").innerHTML = state.materials.length
    ? state.materials
        .map(
          (material) => `
            <div class="employee-row">
              <div>
                <strong>${escapeHTML(material.code)} - ${escapeHTML(material.name)}</strong>
                <span>${escapeHTML(material.unit || "un")} - ${material.active ? "Ativo" : "Inativo"}</span>
                ${material.notes ? `<span>${escapeHTML(material.notes)}</span>` : ""}
              </div>
              <div class="row-actions">
                <button class="ghost-button" type="button" data-action="edit-material" data-id="${escapeHTML(material.id)}"><i data-lucide="pencil"></i>Editar</button>
                <button class="${material.active ? "danger-button" : "primary-button"}" type="button" data-action="toggle-material" data-id="${escapeHTML(material.id)}" data-active="${material.active}">
                  <i data-lucide="${material.active ? "power-off" : "power"}"></i>${material.active ? "Desativar" : "Ativar"}
                </button>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nenhum material cadastrado.</div>`;
  refreshIcons();
}

function renderTeams() {
  const list = $("#teamList");
  if (!list) return;
  list.innerHTML = state.teams.length
    ? state.teams
        .map((team) => {
          const members = (team.employees || []).map((employee) => employee.name).join(", ");
          const leaderName = team.leader?.name || "Sem líder";
          return `
            <div class="employee-row">
              <div>
                <strong>${escapeHTML(team.name)}</strong>
                <span>Líder: ${escapeHTML(leaderName)} - ${team.active ? "Ativa" : "Inativa"}</span>
                <span>${escapeHTML(members || "Sem membros")}</span>
              </div>
              <div class="row-actions">
                <button class="ghost-button" type="button" data-action="edit-team" data-id="${escapeHTML(team.id)}"><i data-lucide="pencil"></i>Editar</button>
                <button class="${team.active ? "danger-button" : "primary-button"}" type="button" data-action="toggle-team" data-id="${escapeHTML(team.id)}" data-active="${team.active}">
                  <i data-lucide="${team.active ? "power-off" : "power"}"></i>${team.active ? "Desativar" : "Ativar"}
                </button>
                <button class="danger-button" type="button" data-action="delete-team" data-id="${escapeHTML(team.id)}"><i data-lucide="trash-2"></i>Excluir</button>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="empty">Nenhuma equipe cadastrada.</div>`;
  refreshIcons();
}

function currentMaterialByCode() {
  const code = normalizeCode($("#materialCodeInput")?.value);
  if (!code) return null;
  return state.materials.find((material) => material.code === code && material.active) || null;
}

function renderMaterialPreview() {
  const preview = $("#materialPreview");
  if (!preview) return;
  const code = normalizeCode($("#materialCodeInput")?.value);
  if (!code) {
    preview.innerHTML = "";
    return;
  }
  const material = currentMaterialByCode();
  preview.innerHTML = material
    ? `<span class="badge done">${escapeHTML(material.code)}</span><strong>${escapeHTML(material.name)}</strong><small>${escapeHTML(material.unit || "un")}</small>`
    : `<span class="badge cancelled">Não encontrado</span><strong>Código ${escapeHTML(code)}</strong><small>Cadastre em Materiais antes de usar no romaneio.</small>`;
}

function renderServiceMaterials() {
  const list = $("#serviceMaterialsList");
  if (!list) return;
  list.innerHTML = state.serviceMaterials.length
    ? state.serviceMaterials
        .map(
          (item, index) => `
            <div class="material-service-row">
              <div>
                <strong>${escapeHTML(item.code)} - ${escapeHTML(item.name)}</strong>
                <span>${escapeHTML(formatQuantity(item.quantity))} ${escapeHTML(item.unit || "un")}${item.notes ? ` · ${escapeHTML(item.notes)}` : ""}</span>
              </div>
              <button class="danger-button" type="button" data-action="remove-service-material" data-index="${index}"><i data-lucide="trash-2"></i>Remover</button>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nenhum material no romaneio.</div>`;
  refreshIcons();
}

function addMaterialToService() {
  const material = currentMaterialByCode();
  if (!material) {
    toast("Materiais", "Código não encontrado. Cadastre o material antes de adicionar ao romaneio.", "error");
    return;
  }

  const quantity = Number($("#materialQuantityInput").value);
  state.serviceMaterials.push({
    materialId: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit || "un",
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    notes: $("#materialNotesInput").value.trim()
  });
  $("#materialCodeInput").value = "";
  $("#materialQuantityInput").value = "1";
  $("#materialNotesInput").value = "";
  renderMaterialPreview();
  renderServiceMaterials();
}

function renderClients() {
  $("#clientList").innerHTML = state.clients.length
    ? state.clients
        .map(
          (client) => `
            <div class="employee-row">
              <div>
                <strong>${escapeHTML(client.name)}</strong>
                <span>${escapeHTML(client.phone || "Sem telefone")} - ${client.active ? "Ativo" : "Inativo"}</span>
                ${client.address ? `<span>${escapeHTML(client.address)}</span>` : ""}
              </div>
              <div class="row-actions">
                <button class="ghost-button" type="button" data-action="edit-client" data-id="${escapeHTML(client.id)}"><i data-lucide="pencil"></i>Editar</button>
                <button class="${client.active ? "danger-button" : "primary-button"}" type="button" data-action="toggle-client" data-id="${escapeHTML(client.id)}" data-active="${client.active}">
                  <i data-lucide="${client.active ? "power-off" : "power"}"></i>${client.active ? "Desativar" : "Ativar"}
                </button>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nenhum cliente cadastrado.</div>`;
  refreshIcons();
}

function renderEmployees() {
  $("#employeeList").innerHTML = state.employees.length
    ? state.employees
        .map(
          (employee) => `
            <div class="employee-row">
              <div>
                <strong>${escapeHTML(employee.name)}</strong>
                <span>${escapeHTML(employee.phone || "Sem telefone")} - ${employee.active ? "Ativo" : "Inativo"}</span>
                <span>PIN: <strong class="pin-code">${escapeHTML(employee.pin || "defina novo PIN")}</strong></span>
              </div>
              <div class="row-actions">
                <button class="ghost-button" type="button" data-action="pin-employee" data-id="${escapeHTML(employee.id)}"><i data-lucide="key-round"></i>Alterar PIN</button>
                <button class="${employee.active ? "danger-button" : "primary-button"}" type="button" data-action="toggle-employee" data-id="${escapeHTML(employee.id)}" data-active="${employee.active}">
                  <i data-lucide="${employee.active ? "power-off" : "power"}"></i>${employee.active ? "Desativar" : "Ativar"}
                </button>
                <button class="danger-button" type="button" data-action="delete-employee" data-id="${escapeHTML(employee.id)}"><i data-lucide="trash-2"></i>Excluir</button>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty">Nenhum funcionário cadastrado.</div>`;
  refreshIcons();
}

function clearServiceForm() {
  state.editingServiceId = null;
  state.serviceMaterials = [];
  $("#serviceForm").reset();
  $("#serviceFormTitle").textContent = "Novo serviço";
  $("#submitServiceButton").innerHTML = `<i data-lucide="send"></i>Enviar serviço`;
  renderClientSelect();
  renderTeamSelect();
  renderEmployeeCheckboxes();
  renderMaterialPreview();
  renderServiceMaterials();
  refreshIcons();
}

function fillServiceForm(service) {
  state.editingServiceId = service.id;
  const form = $("#serviceForm");
  form.elements.id.value = service.id;
  form.elements.title.value = service.title || "";
  form.elements.clientId.value = service.clientId || "";
  form.elements.teamId.value = service.teamId || "";
  form.elements.customer.value = service.customer || "";
  form.elements.location.value = service.location || "";
  form.elements.date.value = service.date || "";
  form.elements.time.value = service.time || "";
  form.elements.address.value = service.address || "";
  form.elements.notes.value = service.notes || "";
  state.serviceMaterials = (service.materials || []).map((item) => ({ ...item }));
  $("#serviceFormTitle").textContent = `Editar ${service.code}`;
  $("#submitServiceButton").innerHTML = `<i data-lucide="save"></i>Salvar alterações`;
  renderClientSelect();
  form.elements.clientId.value = service.clientId || "";
  renderTeamSelect();
  form.elements.teamId.value = service.teamId || "";
  renderEmployeeCheckboxes();
  renderMaterialPreview();
  renderServiceMaterials();
  switchTab("services");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  refreshIcons();
}

function clearClientForm() {
  state.editingClientId = null;
  $("#clientForm").reset();
  $("#clientFormTitle").textContent = "Novo cliente";
  $("#submitClientButton").innerHTML = `<i data-lucide="save"></i>Cadastrar cliente`;
  refreshIcons();
}

function fillClientForm(client) {
  state.editingClientId = client.id;
  const form = $("#clientForm");
  form.elements.id.value = client.id;
  form.elements.name.value = client.name || "";
  form.elements.contact.value = client.contact || "";
  form.elements.phone.value = client.phone || "";
  form.elements.email.value = client.email || "";
  form.elements.address.value = client.address || "";
  form.elements.notes.value = client.notes || "";
  $("#clientFormTitle").textContent = `Editar ${client.name}`;
  $("#submitClientButton").innerHTML = `<i data-lucide="save"></i>Salvar cliente`;
  switchTab("clients");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  refreshIcons();
}

function clearMaterialForm() {
  state.editingMaterialId = null;
  $("#materialForm").reset();
  $("#materialForm").elements.unit.value = "un";
  $("#materialFormTitle").textContent = "Novo material";
  $("#submitMaterialButton").innerHTML = `<i data-lucide="package-plus"></i>Cadastrar material`;
  refreshIcons();
}

function fillMaterialForm(material) {
  state.editingMaterialId = material.id;
  const form = $("#materialForm");
  form.elements.id.value = material.id;
  form.elements.code.value = material.code || "";
  form.elements.unit.value = material.unit || "un";
  form.elements.name.value = material.name || "";
  form.elements.notes.value = material.notes || "";
  $("#materialFormTitle").textContent = `Editar ${material.code}`;
  $("#submitMaterialButton").innerHTML = `<i data-lucide="save"></i>Salvar material`;
  switchTab("materials");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  refreshIcons();
}

function clearTeamForm() {
  state.editingTeamId = null;
  $("#teamForm").reset();
  $("#teamFormTitle").textContent = "Nova equipe";
  $("#submitTeamButton").innerHTML = `<i data-lucide="users-round"></i>Cadastrar equipe`;
  renderTeamLeaderSelect();
  renderTeamEmployeeCheckboxes();
  refreshIcons();
}

function fillTeamForm(team) {
  state.editingTeamId = team.id;
  const form = $("#teamForm");
  form.elements.id.value = team.id;
  form.elements.name.value = team.name || "";
  renderTeamLeaderSelect();
  form.elements.leaderId.value = team.leaderId || "";
  renderTeamEmployeeCheckboxes();
  $("#teamFormTitle").textContent = `Editar ${team.name}`;
  $("#submitTeamButton").innerHTML = `<i data-lucide="save"></i>Salvar equipe`;
  switchTab("teams");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  refreshIcons();
}

function servicePayload() {
  const form = $("#serviceForm");
  const data = Object.fromEntries(new FormData(form).entries());
  data.employeeIds = $$('input[name="employeeIds"]:checked').map((input) => input.value);
  data.materials = state.serviceMaterials.map((item) => ({ ...item }));
  return data;
}

function teamPayload() {
  const form = $("#teamForm");
  const data = Object.fromEntries(new FormData(form).entries());
  data.employeeIds = $$('input[name="teamEmployeeIds"]:checked').map((input) => input.value);
  return data;
}

async function handleClientSubmit(event) {
  event.preventDefault();
  const form = $("#clientForm");
  const payload = Object.fromEntries(new FormData(form).entries());
  const editingId = state.editingClientId;
  const path = editingId ? `/api/clients/${editingId}` : "/api/clients";
  const method = editingId ? "PATCH" : "POST";

  try {
    await api(path, { method, body: payload });
    await loadClients();
    await loadDashboard();
    toast("Clientes", editingId ? "Cliente atualizado." : "Cliente cadastrado.");
    clearClientForm();
  } catch (error) {
    toast("Clientes", error.message, "error");
  }
}

async function handleMaterialSubmit(event) {
  event.preventDefault();
  const form = $("#materialForm");
  const payload = Object.fromEntries(new FormData(form).entries());
  payload.code = normalizeCode(payload.code);
  const editingId = state.editingMaterialId;
  const path = editingId ? `/api/materials/${editingId}` : "/api/materials";
  const method = editingId ? "PATCH" : "POST";

  try {
    await api(path, { method, body: payload });
    await loadMaterials();
    await loadDashboard();
    toast("Materiais", editingId ? "Material atualizado." : "Material cadastrado.");
    clearMaterialForm();
  } catch (error) {
    toast("Materiais", error.message, "error");
  }
}

async function handleTeamSubmit(event) {
  event.preventDefault();
  const payload = teamPayload();
  const editingId = state.editingTeamId;
  const path = editingId ? `/api/teams/${editingId}` : "/api/teams";
  const method = editingId ? "PATCH" : "POST";

  try {
    await api(path, { method, body: payload });
    await loadTeams();
    await loadDashboard();
    toast("Equipes", editingId ? "Equipe atualizada." : "Equipe cadastrada.");
    clearTeamForm();
  } catch (error) {
    toast("Equipes", error.message, "error");
  }
}

async function handleServiceSubmit(event) {
  event.preventDefault();
  const payload = servicePayload();
  const editingId = state.editingServiceId;
  const path = editingId ? `/api/services/${editingId}` : "/api/services";
  const method = editingId ? "PATCH" : "POST";

  try {
    const service = await api(path, { method, body: payload });
    upsertService(service);
    renderServices();
    await loadDashboard();
    toast("Serviço", editingId ? "Serviço atualizado." : "Serviço enviado aos funcionários.");
    clearServiceForm();
  } catch (error) {
    toast("Serviço", error.message, "error");
  }
}

async function toggleClient(clientId, active) {
  try {
    await api(`/api/clients/${clientId}`, { method: "PATCH", body: { active } });
    await loadClients();
    await loadDashboard();
  } catch (error) {
    toast("Clientes", error.message, "error");
  }
}

async function toggleMaterial(materialId, active) {
  try {
    await api(`/api/materials/${materialId}`, { method: "PATCH", body: { active } });
    await loadMaterials();
    await loadDashboard();
  } catch (error) {
    toast("Materiais", error.message, "error");
  }
}

async function toggleTeam(teamId, active) {
  try {
    await api(`/api/teams/${teamId}`, { method: "PATCH", body: { active } });
    await loadTeams();
    await loadDashboard();
  } catch (error) {
    toast("Equipes", error.message, "error");
  }
}

async function deleteTeam(teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team || !window.confirm(`Excluir equipe ${team.name}?`)) return;
  try {
    await api(`/api/teams/${teamId}`, { method: "DELETE" });
    await loadTeams();
    await loadServices();
    await loadDashboard();
    toast("Equipes", "Equipe excluida.");
  } catch (error) {
    toast("Equipes", error.message, "error");
  }
}

async function handleEmployeeSubmit(event) {
  event.preventDefault();
  const form = $("#employeeForm");
  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    await api("/api/employees", { method: "POST", body: payload });
    form.reset();
    await loadEmployees();
    await loadDashboard();
    toast("Funcionário", "Funcionário cadastrado.");
  } catch (error) {
    toast("Funcionário", error.message, "error");
  }
}

async function handleAdminSettingsSubmit(event) {
  event.preventDefault();
  const form = $("#adminSettingsForm");
  const payload = Object.fromEntries(new FormData(form).entries());

  try {
    const { user } = await api("/api/admin/account", { method: "PATCH", body: payload });
    state.user = user;
    form.elements.currentPassword.value = "";
    form.elements.newPassword.value = "";
    form.elements.confirmPassword.value = "";
    showApp();
    toast("Configurações", "Acesso do admin atualizado.");
  } catch (error) {
    toast("Configurações", error.message, "error");
  }
}

async function cancelService(serviceId) {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service || !window.confirm(`Cancelar ${service.code}?`)) return;
  try {
    const updated = await api(`/api/services/${serviceId}/cancel`, { method: "POST" });
    upsertService(updated);
    renderServices();
    await loadDashboard();
    toast("Serviço", `${updated.code} cancelado.`);
  } catch (error) {
    toast("Serviço", error.message, "error");
  }
}

async function toggleEmployee(employeeId, active) {
  try {
    await api(`/api/employees/${employeeId}`, { method: "PATCH", body: { active } });
    await loadEmployees();
    await loadDashboard();
  } catch (error) {
    toast("Funcionário", error.message, "error");
  }
}

async function deleteEmployee(employeeId) {
  const employee = state.employees.find((item) => item.id === employeeId);
  if (!employee || !window.confirm(`Excluir ${employee.name}?`)) return;
  try {
    await api(`/api/employees/${employeeId}`, { method: "DELETE" });
    await loadEmployees();
    await loadTeams();
    await loadDashboard();
    toast("FuncionÃ¡rio", "FuncionÃ¡rio excluido.");
  } catch (error) {
    toast("FuncionÃ¡rio", error.message, "error");
  }
}

async function changeEmployeePin(employeeId) {
  const employee = state.employees.find((item) => item.id === employeeId);
  const pin = window.prompt(`Novo PIN para ${employee?.name || "funcionário"}:`);
  if (!pin) return;
  try {
    await api(`/api/employees/${employeeId}`, { method: "PATCH", body: { pin } });
    await loadEmployees();
    toast("Funcionário", "PIN atualizado.");
  } catch (error) {
    toast("Funcionário", error.message, "error");
  }
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // Session may already be gone.
  }
  showLogin();
}

function bindEvents() {
  $("#adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    window.EGRuntime?.persistConnectionForm(event.currentTarget);
    const credentials = Object.fromEntries(new FormData(event.currentTarget).entries());
    delete credentials.serverUrl;
    try {
      const { token, user } = await api("/api/auth/admin", { method: "POST", body: credentials });
      state.token = token;
      state.user = user;
      localStorage.setItem("egAdminToken", token);
      showApp();
      connectSocket();
      await loadAll();
    } catch (error) {
      toast("Login", error.message, "error");
    }
  });

  $$(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  $("#notificationButton").addEventListener("click", requestNotifications);
  $("#logoutButton").addEventListener("click", logout);
  $("#serviceForm").addEventListener("submit", handleServiceSubmit);
  $("#clearServiceFormButton").addEventListener("click", clearServiceForm);
  $("#clientForm").addEventListener("submit", handleClientSubmit);
  $("#clearClientFormButton").addEventListener("click", clearClientForm);
  $("#materialForm").addEventListener("submit", handleMaterialSubmit);
  $("#clearMaterialFormButton").addEventListener("click", clearMaterialForm);
  $("#teamForm").addEventListener("submit", handleTeamSubmit);
  $("#clearTeamFormButton").addEventListener("click", clearTeamForm);
  $("#materialCodeInput").addEventListener("input", renderMaterialPreview);
  $("#addMaterialToServiceButton").addEventListener("click", addMaterialToService);
  $("#teamSelect").addEventListener("change", renderEmployeeCheckboxes);
  $("#teamEmployeeCheckboxes").addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[name="teamEmployeeIds"]');
    if (!checkbox) return;
    const leader = $("#teamLeaderSelect");
    if (checkbox.checked && !leader.value) leader.value = checkbox.value;
    if (!checkbox.checked && leader.value === checkbox.value) leader.value = "";
  });
  $("#statusFilter").addEventListener("change", renderServices);
  $("#clientFilter").addEventListener("change", renderServices);
  $("#teamFilter").addEventListener("change", renderServices);
  $("#dateFromFilter").addEventListener("change", renderServices);
  $("#dateToFilter").addEventListener("change", renderServices);
  $("#clearServiceFiltersButton").addEventListener("click", () => {
    $("#clientFilter").value = "";
    $("#teamFilter").value = "";
    $("#statusFilter").value = "all";
    $("#dateFromFilter").value = "";
    $("#dateToFilter").value = "";
    renderServices();
  });
  $("#employeeForm").addEventListener("submit", handleEmployeeSubmit);
  $("#adminSettingsForm").addEventListener("submit", handleAdminSettingsSubmit);
  $("#clientSelect").addEventListener("change", (event) => {
    const client = state.clients.find((item) => item.id === event.target.value);
    const form = $("#serviceForm");
    if (!client) return;
    form.elements.customer.value = client.name || "";
    if (client.address) form.elements.address.value = client.address;
  });

  $("#serviceList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-service") {
      const service = state.services.find((item) => item.id === button.dataset.id);
      if (service) fillServiceForm(service);
    }
    if (button.dataset.action === "cancel-service") {
      cancelService(button.dataset.id);
    }
    if (button.dataset.action === "open-report") {
      openServiceReport(button.dataset.id);
    }
    if (button.dataset.action === "send-report") {
      sendServiceReport(button.dataset.id);
    }
  });

  $("#serviceMaterialsList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.dataset.action !== "remove-service-material") return;
    state.serviceMaterials.splice(Number(button.dataset.index), 1);
    renderServiceMaterials();
  });

  $("#clientList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-client") {
      const client = state.clients.find((item) => item.id === button.dataset.id);
      if (client) fillClientForm(client);
    }
    if (button.dataset.action === "toggle-client") {
      toggleClient(button.dataset.id, button.dataset.active !== "true");
    }
  });

  $("#materialList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-material") {
      const material = state.materials.find((item) => item.id === button.dataset.id);
      if (material) fillMaterialForm(material);
    }
    if (button.dataset.action === "toggle-material") {
      toggleMaterial(button.dataset.id, button.dataset.active !== "true");
    }
  });

  $("#teamList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit-team") {
      const team = state.teams.find((item) => item.id === button.dataset.id);
      if (team) fillTeamForm(team);
    }
    if (button.dataset.action === "toggle-team") {
      toggleTeam(button.dataset.id, button.dataset.active !== "true");
    }
    if (button.dataset.action === "delete-team") {
      deleteTeam(button.dataset.id);
    }
  });

  $("#employeeList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "toggle-employee") {
      toggleEmployee(button.dataset.id, button.dataset.active !== "true");
    }
    if (button.dataset.action === "pin-employee") {
      changeEmployeePin(button.dataset.id);
    }
    if (button.dataset.action === "delete-employee") {
      deleteEmployee(button.dataset.id);
    }
  });
}

async function boot() {
  bindEvents();
  window.EGRuntime?.fillConnectionForm($("#adminLoginForm"));
  refreshIcons();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  if (!state.token) {
    showLogin();
    return;
  }

  try {
    await loadMe();
    showApp();
    connectSocket();
    await loadAll();
  } catch {
    showLogin();
  }
}

boot();
