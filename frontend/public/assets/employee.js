const state = {
  token: localStorage.getItem("egEmployeeToken"),
  user: null,
  socket: null,
  services: [],
  teams: [],
  pendingStartLocations: loadPendingStartLocations(),
  pendingFinalLocations: loadPendingFinalLocations(),
  pendingBeforePhotos: loadPendingPhotos("egPendingBeforePhotos"),
  pendingAfterPhotos: loadPendingPhotos("egPendingAfterPhotos"),
  reportPreferences: loadReportPreferences(),
  signaturePads: new Map(),
  clockTimer: null
};

const statusLabels = {
  scheduled: "Agendado",
  in_progress: "Iniciado",
  done: "Finalizado",
  cancelled: "Cancelado"
};

const $ = (selector) => document.querySelector(selector);

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

function currentTime() {
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "medium"
  }).format(new Date());
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function formatQuantity(value) {
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : number.toLocaleString("pt-BR");
}

function servicePrice(service) {
  const value = Number(service?.price || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function isServicePriced(service) {
  return service?.priceStatus === "PRICED" && servicePrice(service) > 0;
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(number) ? number : 0);
}

function loadPendingStartLocations() {
  try {
    return JSON.parse(localStorage.getItem("egPendingStartLocations") || "{}");
  } catch {
    return {};
  }
}

function savePendingStartLocations() {
  localStorage.setItem("egPendingStartLocations", JSON.stringify(state.pendingStartLocations));
}

function loadPendingFinalLocations() {
  try {
    return JSON.parse(localStorage.getItem("egPendingFinalLocations") || "{}");
  } catch {
    return {};
  }
}

function savePendingFinalLocations() {
  localStorage.setItem("egPendingFinalLocations", JSON.stringify(state.pendingFinalLocations));
}

function loadPendingPhotos(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function savePendingPhotos(key, photos) {
  try {
    localStorage.setItem(key, JSON.stringify(photos));
  } catch {
    toast("Foto", "A foto ficou grande demais para salvar localmente. Tente tirar uma foto mais leve.", "error");
  }
}

function loadReportPreferences() {
  try {
    return JSON.parse(localStorage.getItem("egReportPreferences") || "{}");
  } catch {
    return {};
  }
}

function saveReportPreferences() {
  localStorage.setItem("egReportPreferences", JSON.stringify(state.reportPreferences));
}

function getPendingStartLocation(serviceId) {
  return state.pendingStartLocations[serviceId] || null;
}

function setPendingStartLocation(serviceId, location) {
  if (location) state.pendingStartLocations[serviceId] = location;
  else delete state.pendingStartLocations[serviceId];
  savePendingStartLocations();
}

function getPendingFinalLocation(serviceId) {
  return state.pendingFinalLocations[serviceId] || null;
}

function setPendingFinalLocation(serviceId, location) {
  if (location) state.pendingFinalLocations[serviceId] = location;
  else delete state.pendingFinalLocations[serviceId];
  savePendingFinalLocations();
}

function getPendingBeforePhoto(serviceId) {
  return state.pendingBeforePhotos[serviceId] || null;
}

function setPendingBeforePhoto(serviceId, photo) {
  if (photo) state.pendingBeforePhotos[serviceId] = photo;
  else delete state.pendingBeforePhotos[serviceId];
  savePendingPhotos("egPendingBeforePhotos", state.pendingBeforePhotos);
}

function getPendingAfterPhoto(serviceId) {
  return state.pendingAfterPhotos[serviceId] || null;
}

function setPendingAfterPhoto(serviceId, photo) {
  if (photo) state.pendingAfterPhotos[serviceId] = photo;
  else delete state.pendingAfterPhotos[serviceId];
  savePendingPhotos("egPendingAfterPhotos", state.pendingAfterPhotos);
}

function getReportPreference(serviceId, service) {
  const defaults = {
    sendToClient: Boolean(service?.reportPreference?.sendToClient),
    clientEmail: service?.reportPreference?.clientEmail || service?.client?.email || ""
  };
  return { ...defaults, ...(state.reportPreferences[serviceId] || {}) };
}

function setReportPreference(serviceId, patch) {
  const current = state.reportPreferences[serviceId] || {};
  state.reportPreferences[serviceId] = { ...current, ...patch };
  saveReportPreferences();
}

function clearReportPreference(serviceId) {
  delete state.reportPreferences[serviceId];
  saveReportPreferences();
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

function makeManualLocation(text) {
  const value = String(text || "").trim();
  if (!value) return null;
  return {
    type: "manual",
    label: value,
    manualText: value,
    mapsUrl: /^https?:\/\//i.test(value) ? value : "",
    capturedAt: new Date().toISOString()
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler a foto."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel preparar a foto."));
    image.src = dataUrl;
  });
}

async function fileToServicePhoto(file, stage) {
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const maxSize = 1280;
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  const imageDataUrl = canvas.toDataURL("image/jpeg", 0.78);
  return {
    stage,
    label: stage === "before" ? "Antes do servico" : "Depois do servico",
    imageDataUrl,
    capturedAt: new Date().toISOString(),
    fileName: file.name || ""
  };
}

function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Este navegador não liberou GPS. Digite ou cole o link da localização."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });
  });
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
    throw new Error(payload.error || "Erro ao processar solicitação.");
  }
  return payload;
}

function showLogin() {
  localStorage.removeItem("egEmployeeToken");
  state.token = null;
  state.user = null;
  if (state.socket) state.socket.disconnect();
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  window.EGRuntime?.fillConnectionForm($("#employeeLoginForm"));
  refreshIcons();
}

function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  $("#employeeName").textContent = state.user?.name || "Funcionário";
  startClock();
}

function startClock() {
  if (state.clockTimer) window.clearInterval(state.clockTimer);
  const tick = () => {
    document.querySelectorAll("[data-live-clock]").forEach((node) => {
      node.textContent = currentTime();
    });
  };
  tick();
  state.clockTimer = window.setInterval(tick, 1000);
}

function connectSocket() {
  if (state.socket) state.socket.disconnect();
  const socketUrl = window.EGRuntime?.socketUrl();
  state.socket = socketUrl ? io(socketUrl, { auth: { token: state.token } }) : io({ auth: { token: state.token } });

  state.socket.on("connect_error", () => {
    toast("Conexão em tempo real", "Não foi possível conectar aos avisos.", "error");
  });

  state.socket.on("service:created", ({ service, message }) => {
    upsertService(service);
    renderServices();
    renderTeams();
    toast("Novo serviço", message || `${service.code} enviado.`);
    browserNotify("Novo serviço", `${service.code} - ${service.title}`);
  });

  state.socket.on("service:updated", ({ service, message }) => {
    upsertService(service);
    renderServices();
    renderTeams();
    toast("Serviço atualizado", message || `${service.code} atualizado.`);
    browserNotify("Serviço atualizado", message || `${service.code} atualizado.`);
  });
  state.socket.on("team:updated", async ({ message }) => {
    await loadAll();
    toast("Equipe", message || "Equipe atualizada.");
    browserNotify("Equipe", message || "Equipe atualizada.");
  });
}

function upsertService(service) {
  if (Array.isArray(service.employeeIds) && state.user?.id && !service.employeeIds.includes(state.user.id)) {
    state.services = state.services.filter((item) => item.id !== service.id);
    return;
  }
  const index = state.services.findIndex((item) => item.id === service.id);
  if (index >= 0) state.services[index] = service;
  else state.services.unshift(service);
}

async function loadMe() {
  const { user } = await api("/api/me");
  state.user = user;
}

async function loadServices() {
  state.services = await api("/api/services");
  renderServices();
}

async function loadTeams() {
  state.teams = await api("/api/my-teams");
  renderTeams();
}

async function loadAll() {
  await Promise.all([loadServices(), loadTeams()]);
  renderTeams();
}

function updateCounts(groups) {
  $("#scheduledCount").textContent = groups.scheduled.length;
  $("#progressCount").textContent = groups.in_progress.length;
  $("#doneCount").textContent = groups.done.length;
  $("#scheduledBadge").textContent = groups.scheduled.length;
  $("#progressBadge").textContent = groups.in_progress.length;
  $("#doneBadge").textContent = groups.done.length;
}

function renderTeams() {
  const list = $("#employeeTeamList");
  if (!list) return;
  list.innerHTML = state.teams.length
    ? state.teams
        .map((team) => {
          const leaderName = team.leader?.name || "Sem lider";
          const isLeader = team.leaderId === state.user?.id;
          const teammates = (team.employees || []).filter((employee) => employee.id !== state.user?.id);
          const activeServices = state.services.filter((service) => service.teamId === team.id && service.status !== "cancelled").length;
          return `
            <div class="employee-row">
              <div>
                <strong>${escapeHTML(team.name)}</strong>
                <span>Lider: ${escapeHTML(leaderName)} - ${isLeader ? "voce e responsavel" : "membro da equipe"}</span>
                <span>${activeServices} servico(s) vinculados</span>
                <div class="team-member-list">
                  ${teammates.length
                    ? teammates.map((employee) => `<span class="badge scheduled">${escapeHTML(employee.name)}</span>`).join("")
                    : `<span class="badge done">Sem companheiros</span>`}
                </div>
              </div>
              <span class="badge ${isLeader ? "done" : "scheduled"}">${isLeader ? "Lider" : "Membro"}</span>
            </div>
          `;
        })
        .join("")
    : `<div class="empty">Voce ainda nao esta em uma equipe.</div>`;
  refreshIcons();
}

function materialsBlock(materials = []) {
  if (!materials.length) {
    return `<div class="materials-summary"><strong>Materiais</strong><span>Nenhum material no romaneio.</span></div>`;
  }
  return `
    <div class="materials-summary">
      <strong>Materiais</strong>
      ${materials
        .map(
          (item) => `
            <span>${escapeHTML(normalizeCode(item.code))} - ${escapeHTML(item.name)} · ${escapeHTML(formatQuantity(item.quantity))} ${escapeHTML(item.unit || "un")}${item.notes ? ` · ${escapeHTML(item.notes)}` : ""}</span>
          `
        )
        .join("")}
    </div>
  `;
}

function locationSummary(title, location) {
  if (!location) return "";
  return `
    <div class="location-summary">
      <strong>${escapeHTML(title)}</strong>
      <span>${escapeHTML(formatLocation(location))}</span>
      <small>${escapeHTML(shortDate(location.capturedAt))}</small>
      ${location.mapsUrl ? `<a class="ghost-button compact-link" href="${escapeHTML(location.mapsUrl)}" target="_blank" rel="noreferrer"><i data-lucide="map"></i>Abrir mapa</a>` : ""}
    </div>
  `;
}

function signatureSummary(signature) {
  if (!signature?.imageDataUrl) return "";
  return `
    <div class="signature-summary">
      <div>
        <strong>Assinatura do cliente</strong>
        <span>${escapeHTML(signature.signerName || "Cliente")} · ${escapeHTML(shortDate(signature.signedAt))}</span>
      </div>
      <img src="${escapeHTML(signature.imageDataUrl)}" alt="Assinatura do cliente">
    </div>
  `;
}

function photoSummary(servicePhotos = {}) {
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
  const leaderName = service.team.leader?.name || "Sem lider";
  const teammates = (service.team.employees || [])
    .filter((employee) => employee.id !== state.user?.id)
    .map((employee) => employee.name)
    .join(", ");
  return `
    <div class="materials-summary team-summary">
      <strong>Equipe: ${escapeHTML(service.team.name)}</strong>
      <span>Lider responsavel: ${escapeHTML(leaderName)}</span>
      <span>Companheiros: ${escapeHTML(teammates || "Sem companheiros")}</span>
    </div>
  `;
}

function leaderProtocolNotice(service) {
  if (!service.team || service.team.leaderId === state.user?.id) return "";
  const leaderName = service.team.leader?.name || "lider da equipe";
  return `
    <div class="location-summary">
      <strong>Responsavel pelo protocolo</strong>
      <span>${escapeHTML(leaderName)} inicia e finaliza este servico pela equipe.</span>
    </div>
  `;
}

function startControls(service) {
  const location = getPendingStartLocation(service.id);
  const beforePhoto = getPendingBeforePhoto(service.id);
  return `
    <div class="location-capture">
      <label class="field">
        <span>Localização de início</span>
        <input class="input" data-start-location-input data-id="${escapeHTML(service.id)}" value="${escapeHTML(formatLocation(location))}" placeholder="Cole o link do Maps, digite o local ou use GPS">
      </label>
      <label class="field">
        <span>Foto antes do servico</span>
        <input class="input" type="file" accept="image/*" capture="environment" data-before-photo-input data-id="${escapeHTML(service.id)}">
      </label>
      ${
        beforePhoto?.imageDataUrl
          ? `<div class="photo-preview">
              <img src="${escapeHTML(beforePhoto.imageDataUrl)}" alt="Foto antes do servico">
              <span>Foto antes salva para envio.</span>
              <button class="ghost-button compact-link" type="button" data-action="clear-before-photo" data-id="${escapeHTML(service.id)}"><i data-lucide="trash-2"></i>Remover</button>
            </div>`
          : ""
      }
      <div class="row-actions">
        <button class="ghost-button" type="button" data-action="capture-start-location" data-id="${escapeHTML(service.id)}"><i data-lucide="map-pin"></i>Usar GPS</button>
        <button class="status-button" type="button" data-action="start" data-id="${escapeHTML(service.id)}"><i data-lucide="play"></i>Iniciar</button>
      </div>
    </div>
  `;
}

function finishControls(service) {
  const finalLocation = getPendingFinalLocation(service.id);
  const afterPhoto = getPendingAfterPhoto(service.id);
  const report = getReportPreference(service.id, service);
  return `
    <div class="finish-box">
      <div class="time-proof">
        <strong>Horário atual</strong>
        <span data-live-clock>${currentTime()}</span>
        <small>Iniciado em ${escapeHTML(shortDate(service.startedAt))}</small>
      </div>
      <label class="field">
        <span>Localização final</span>
        <input class="input" data-final-location-input data-id="${escapeHTML(service.id)}" value="${escapeHTML(formatLocation(finalLocation))}" placeholder="Cole o link do Maps, digite o local ou use GPS">
      </label>
      <label class="field">
        <span>Foto depois do servico</span>
        <input class="input" type="file" accept="image/*" capture="environment" data-after-photo-input data-id="${escapeHTML(service.id)}">
      </label>
      ${
        afterPhoto?.imageDataUrl
          ? `<div class="photo-preview">
              <img src="${escapeHTML(afterPhoto.imageDataUrl)}" alt="Foto depois do servico">
              <span>Foto depois salva para finalizar.</span>
              <button class="ghost-button compact-link" type="button" data-action="clear-after-photo" data-id="${escapeHTML(service.id)}"><i data-lucide="trash-2"></i>Remover</button>
            </div>`
          : ""
      }
      <label class="field">
        <span>Nome de quem assina</span>
        <input class="input" data-signer-name data-id="${escapeHTML(service.id)}" placeholder="Nome do cliente ou responsável">
      </label>
      <div class="report-choice">
        <label class="checkbox-item">
          <input type="checkbox" data-report-send-input data-id="${escapeHTML(service.id)}" ${report.sendToClient ? "checked" : ""}>
          <span>Preparar envio do relatorio ao cliente</span>
        </label>
        <label class="field">
          <span>E-mail do cliente</span>
          <input class="input" type="email" data-report-email-input data-id="${escapeHTML(service.id)}" value="${escapeHTML(report.clientEmail || "")}" placeholder="cliente@empresa.com.br">
        </label>
      </div>
      <div class="signature-pad-wrap">
        <canvas class="signature-pad" data-signature-pad data-id="${escapeHTML(service.id)}" width="620" height="190"></canvas>
        <div class="row-actions">
          <button class="ghost-button" type="button" data-action="clear-signature" data-id="${escapeHTML(service.id)}"><i data-lucide="eraser"></i>Limpar assinatura</button>
          <button class="ghost-button" type="button" data-action="capture-final-location" data-id="${escapeHTML(service.id)}"><i data-lucide="map-pin-check"></i>Usar GPS final</button>
          <button class="status-button finish" type="button" data-action="finish" data-id="${escapeHTML(service.id)}"><i data-lucide="check-circle-2"></i>Finalizar</button>
        </div>
      </div>
    </div>
  `;
}

function serviceCard(service) {
  const customerName = service.client?.name || service.customer || "Cliente não informado";
  const customerContact = service.client?.contact ? `Contato: ${service.client.contact}` : "";
  const protocolLocked = service.team && service.team.leaderId !== state.user?.id && ["scheduled", "in_progress"].includes(service.status);
  const action = protocolLocked
    ? leaderProtocolNotice(service)
    : service.status === "scheduled"
      ? startControls(service)
      : service.status === "in_progress"
        ? finishControls(service)
        : "";

  return `
    <article class="service-card work-order-card">
      <div class="service-card-header">
        <div>
          <h3>${escapeHTML(service.code)} - ${escapeHTML(service.title)}</h3>
          <div class="meta">
            <span>${formatDateTime(service)}</span>
            <span>${escapeHTML(service.location)}</span>
            <span>${escapeHTML(isServicePriced(service) ? formatCurrency(servicePrice(service)) : "Aguardando preco")}</span>
            <span>${escapeHTML(statusLabels[service.status] || service.status)}</span>
          </div>
        </div>
        <span class="badge ${escapeHTML(service.status)}">${escapeHTML(statusLabels[service.status] || service.status)}</span>
      </div>
      <div class="work-order-grid">
        <div>
          <strong>Cliente/empresa</strong>
          <span>${escapeHTML(customerName)}</span>
          ${customerContact ? `<small>${escapeHTML(customerContact)}</small>` : ""}
        </div>
        <div>
          <strong>Data e horário</strong>
          <span>${escapeHTML(formatDateTime(service))}</span>
        </div>
        <div>
          <strong>Local</strong>
          <span>${escapeHTML(service.location)}</span>
          <small>${escapeHTML(service.address)}</small>
        </div>
        <div>
          <strong>Tipo de serviço</strong>
          <span>${escapeHTML(service.title)}</span>
        </div>
        <div>
          <strong>Valor do servico</strong>
          <span>${escapeHTML(isServicePriced(service) ? formatCurrency(servicePrice(service)) : "Aguardando preco")}</span>
        </div>
      </div>
      ${teamBlock(service)}
      ${materialsBlock(service.materials || [])}
      ${service.notes ? `<p class="notes">${escapeHTML(service.notes)}</p>` : ""}
      ${locationSummary("Localização de início", service.startLocation)}
      ${locationSummary("Localização final", service.finalLocation)}
      ${photoSummary(service.servicePhotos)}
      ${signatureSummary(service.clientSignature)}
      ${action}
    </article>
  `;
}

function renderGroup(selector, services, emptyText) {
  $(selector).innerHTML = services.length
    ? services.map(serviceCard).join("")
    : `<div class="empty">${escapeHTML(emptyText)}</div>`;
}

function renderServices() {
  const activeServices = state.services.filter((service) => service.status !== "cancelled");
  const sorted = activeServices
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const groups = {
    scheduled: sorted.filter((service) => service.status === "scheduled"),
    in_progress: sorted.filter((service) => service.status === "in_progress"),
    done: sorted.filter((service) => service.status === "done").reverse()
  };

  updateCounts(groups);
  renderGroup("#scheduledList", groups.scheduled, "Nenhum serviço agendado.");
  renderGroup("#progressList", groups.in_progress, "Nenhum serviço em andamento.");
  renderGroup("#doneList", groups.done, "Nenhum serviço finalizado.");
  state.signaturePads.clear();
  setupSignaturePads();
  startClock();
  refreshIcons();
}

async function setServiceStatus(serviceId, action) {
  const endpoint = action === "start" ? "start" : "finish";
  const currentService = state.services.find((service) => service.id === serviceId);
  if (action === "start" && !getPendingStartLocation(serviceId)) {
    toast("Localizacao", "Informe a localizacao de inicio antes de iniciar.", "error");
    return;
  }
  if (action === "finish" && !getPendingFinalLocation(serviceId)) {
    toast("Localizacao", "Informe a localizacao final antes de finalizar.", "error");
    return;
  }
  if (action === "start" && !getPendingBeforePhoto(serviceId)) {
    toast("Foto", "Tire ou anexe a foto de antes antes de iniciar.", "error");
    return;
  }
  if (action === "finish" && !getPendingAfterPhoto(serviceId)) {
    toast("Foto", "Tire ou anexe a foto de depois antes de finalizar.", "error");
    return;
  }
  const signature = action === "finish" ? signaturePayload(serviceId) : null;
  if (action === "finish" && !signature) {
    toast("Assinatura", "Peça para o cliente assinar no campo antes de finalizar.", "error");
    return;
  }
  const report = getReportPreference(serviceId, currentService);
  const body = action === "start"
    ? { startLocation: getPendingStartLocation(serviceId), beforePhoto: getPendingBeforePhoto(serviceId) }
    : {
        finalLocation: getPendingFinalLocation(serviceId),
        afterPhoto: getPendingAfterPhoto(serviceId),
        signature,
        report
      };

  try {
    const service = await api(`/api/services/${serviceId}/${endpoint}`, { method: "POST", body });
    if (action === "start") {
      setPendingStartLocation(serviceId, null);
      setPendingBeforePhoto(serviceId, null);
    }
    if (action === "finish") {
      setPendingStartLocation(serviceId, null);
      setPendingFinalLocation(serviceId, null);
      setPendingAfterPhoto(serviceId, null);
      clearReportPreference(serviceId);
    }
    upsertService(service);
    renderServices();
    renderTeams();
    toast("Serviço", action === "start" ? "Serviço iniciado." : "Serviço finalizado.");
  } catch (error) {
    toast("Serviço", error.message, "error");
  }
}

async function captureStartLocation(serviceId) {
  try {
    toast("Localização", "Buscando localização atual...");
    const position = await getBrowserPosition();
    const { latitude, longitude, accuracy } = position.coords;
    setPendingStartLocation(serviceId, {
      type: "gps",
      label: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      latitude,
      longitude,
      accuracy: accuracy ? Math.round(accuracy) : null,
      mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
      capturedAt: new Date().toISOString()
    });
    renderServices();
    toast("Localização", "Localização de início capturada. Não há rastreamento contínuo.");
  } catch (error) {
    toast("Localização", error.message || "Não foi possível pegar o GPS. Digite ou cole o link da localização.", "error");
  }
}

async function captureFinalLocation(serviceId) {
  try {
    toast("Localizacao", "Buscando localizacao final...");
    const position = await getBrowserPosition();
    const { latitude, longitude, accuracy } = position.coords;
    setPendingFinalLocation(serviceId, {
      type: "gps",
      label: `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      latitude,
      longitude,
      accuracy: accuracy ? Math.round(accuracy) : null,
      mapsUrl: `https://www.google.com/maps?q=${latitude},${longitude}`,
      capturedAt: new Date().toISOString()
    });
    renderServices();
    toast("Localizacao", "Localizacao final capturada.");
  } catch (error) {
    toast("Localizacao", error.message || "Nao foi possivel pegar o GPS. Digite ou cole o link da localizacao.", "error");
  }
}

async function handleServicePhotoInput(input, stage) {
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("Foto", "Selecione uma imagem valida.", "error");
    input.value = "";
    return;
  }

  try {
    toast("Foto", "Preparando foto para o protocolo...");
    const photo = await fileToServicePhoto(file, stage);
    if (stage === "before") setPendingBeforePhoto(input.dataset.id, photo);
    else setPendingAfterPhoto(input.dataset.id, photo);
    renderServices();
    toast("Foto", stage === "before" ? "Foto antes salva." : "Foto depois salva.");
  } catch (error) {
    toast("Foto", error.message || "Nao foi possivel salvar a foto.", "error");
  } finally {
    input.value = "";
  }
}

function setupSignaturePads() {
  document.querySelectorAll("[data-signature-pad]").forEach((canvas) => {
    const serviceId = canvas.dataset.id;
    if (state.signaturePads.has(serviceId)) return;

    const context = canvas.getContext("2d");
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#18332f";
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    let drawing = false;
    let dirty = false;

    const point = (event) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY
      };
    };

    const start = (event) => {
      event.preventDefault();
      drawing = true;
      dirty = true;
      const { x, y } = point(event);
      context.beginPath();
      context.moveTo(x, y);
    };

    const move = (event) => {
      if (!drawing) return;
      event.preventDefault();
      const { x, y } = point(event);
      context.lineTo(x, y);
      context.stroke();
    };

    const stop = () => {
      drawing = false;
    };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointerleave", stop);
    canvas.addEventListener("pointercancel", stop);

    state.signaturePads.set(serviceId, {
      canvas,
      context,
      hasSignature: () => dirty,
      clear: () => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = "#18332f";
        dirty = false;
      }
    });
  });
}

function signaturePayload(serviceId) {
  const pad = state.signaturePads.get(serviceId);
  if (!pad?.hasSignature()) return null;
  const signerName = document.querySelector(`[data-signer-name][data-id="${CSS.escape(serviceId)}"]`)?.value || "";
  return {
    signerName,
    imageDataUrl: pad.canvas.toDataURL("image/png")
  };
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
  $("#employeeLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    window.EGRuntime?.persistConnectionForm(event.currentTarget);
    const credentials = Object.fromEntries(new FormData(event.currentTarget).entries());
    delete credentials.serverUrl;
    try {
      const { token, user } = await api("/api/auth/employee", { method: "POST", body: credentials });
      state.token = token;
      state.user = user;
      localStorage.setItem("egEmployeeToken", token);
      showApp();
      connectSocket();
      await loadAll();
    } catch (error) {
      toast("Login", error.message, "error");
    }
  });

  $("#notificationButton").addEventListener("click", requestNotifications);
  $("#refreshButton").addEventListener("click", loadAll);
  $("#logoutButton").addEventListener("click", logout);

  document.body.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "capture-start-location") {
      captureStartLocation(button.dataset.id);
      return;
    }
    if (button.dataset.action === "capture-final-location") {
      captureFinalLocation(button.dataset.id);
      return;
    }
    if (button.dataset.action === "clear-signature") {
      state.signaturePads.get(button.dataset.id)?.clear();
      return;
    }
    if (button.dataset.action === "clear-before-photo") {
      setPendingBeforePhoto(button.dataset.id, null);
      renderServices();
      return;
    }
    if (button.dataset.action === "clear-after-photo") {
      setPendingAfterPhoto(button.dataset.id, null);
      renderServices();
      return;
    }
    setServiceStatus(button.dataset.id, button.dataset.action);
  });

  document.body.addEventListener("input", (event) => {
    const input = event.target.closest("input[data-start-location-input]");
    if (input) {
      setPendingStartLocation(input.dataset.id, makeManualLocation(input.value));
      return;
    }
    const finalInput = event.target.closest("input[data-final-location-input]");
    if (finalInput) {
      setPendingFinalLocation(finalInput.dataset.id, makeManualLocation(finalInput.value));
    }
    const reportEmail = event.target.closest("input[data-report-email-input]");
    if (reportEmail) {
      setReportPreference(reportEmail.dataset.id, { clientEmail: reportEmail.value });
    }
  });

  document.body.addEventListener("change", (event) => {
    const beforeInput = event.target.closest("input[data-before-photo-input]");
    if (beforeInput) {
      handleServicePhotoInput(beforeInput, "before");
      return;
    }
    const afterInput = event.target.closest("input[data-after-photo-input]");
    if (afterInput) {
      handleServicePhotoInput(afterInput, "after");
      return;
    }
    const reportSend = event.target.closest("input[data-report-send-input]");
    if (reportSend) {
      setReportPreference(reportSend.dataset.id, { sendToClient: reportSend.checked });
    }
  });
}

async function boot() {
  bindEvents();
  window.EGRuntime?.fillConnectionForm($("#employeeLoginForm"));
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
