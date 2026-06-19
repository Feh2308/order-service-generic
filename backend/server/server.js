const crypto = require("crypto");
const http = require("http");
const express = require("express");
const morgan = require("morgan");
const { Server } = require("socket.io");
const config = require("./config");
const store = require("./store");
const reports = require("./reports");

const tokens = new Map();

const app = express();
app.set("trust proxy", config.TRUST_PROXY);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      callback(null, config.isOriginAllowed(origin));
    },
    credentials: true
  }
});

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = config.isOriginAllowed(origin);

  if (!allowed) {
    if (req.method === "OPTIONS") return res.sendStatus(403);
    return res.status(403).json({ error: "Origem não autorizada." });
  }

  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  if (origin) res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((_req, res, next) => {
  res.charset = "utf-8";
  next();
});

app.use(morgan(config.HTTP_LOG_FORMAT));
app.use(express.json({ limit: config.JSON_LIMIT }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    appName: config.APP_NAME,
    frontendUrl: config.FRONTEND_URL,
    health: "/api/health"
  });
});

function makeToken(user) {
  const token = crypto.randomBytes(32).toString("hex");
  tokens.set(token, {
    id: user.id,
    role: user.role || "employee",
    name: user.name,
    email: user.email,
    expiresAt: config.AUTH_TOKEN_TTL_MS ? Date.now() + config.AUTH_TOKEN_TTL_MS : null
  });
  return token;
}

function getSession(token) {
  const session = tokens.get(token);
  if (!session) return null;
  if (session.expiresAt && session.expiresAt < Date.now()) {
    tokens.delete(token);
    return null;
  }
  return session;
}

function getToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

function auth(role) {
  return (req, res, next) => {
    const token = getToken(req);
    const user = token ? getSession(token) : null;
    if (!user) {
      return res.status(401).json({ error: "Sessao expirada. Faca login novamente." });
    }
    if (role && user.role !== role) {
      return res.status(403).json({ error: "Acesso não autorizado." });
    }
    req.user = user;
    req.token = token;
    next();
  };
}

function validateService(payload) {
  const required = [
    ["title", "Informe o nome do serviço."],
    ["date", "Informe a data."],
    ["time", "Informe o horário."],
    ["location", "Informe o local."],
    ["address", "Informe o endereço."]
  ];
  for (const [field, message] of required) {
    if (!String(payload[field] || "").trim()) return message;
  }

  const teamId = String(payload.teamId || "").trim();
  if (teamId) {
    const team = store.db.teams.find((item) => item.id === teamId && item.active);
    if (!team) return "Equipe selecionada não encontrada ou inativa.";
    if (!team.employeeIds.length) return "Equipe selecionada não possui funcionários.";
  }

  if (!teamId && (!Array.isArray(payload.employeeIds) || payload.employeeIds.length === 0)) {
    return "Selecione pelo menos um funcionário.";
  }

  const activeEmployeeIds = new Set(store.db.employees.filter((employee) => employee.active).map((employee) => employee.id));
  const invalidEmployee = (payload.employeeIds || []).find((employeeId) => !activeEmployeeIds.has(employeeId));
  if (invalidEmployee) return "Funcionário selecionado não encontrado ou inativo.";

  const clientId = String(payload.clientId || "").trim();
  if (clientId) {
    const client = store.db.clients.find((item) => item.id === clientId && item.active);
    if (!client) return "Cliente selecionado não encontrado ou inativo.";
  }
  return null;
}

function validateTeamPayload(payload) {
  const name = String(payload.name || "").trim();
  const leaderId = String(payload.leaderId || "").trim();
  const employeeIds = Array.isArray(payload.employeeIds) ? Array.from(new Set(payload.employeeIds)) : [];
  const activeEmployeeIds = new Set(store.db.employees.filter((employee) => employee.active).map((employee) => employee.id));

  if (!name) return "Informe o nome da equipe.";
  if (employeeIds.length === 0) return "Selecione pelo menos um funcionário para a equipe.";
  if (!leaderId) return "Escolha um líder para a equipe.";
  if (!employeeIds.includes(leaderId)) return "O líder precisa fazer parte da equipe.";
  const invalidEmployee = employeeIds.find((employeeId) => !activeEmployeeIds.has(employeeId));
  if (invalidEmployee) return "Equipe possui funcionário não encontrado ou inativo.";
  return null;
}

function hasLocationProof(payload, field) {
  const location = payload?.[field];
  if (!location || typeof location !== "object") return false;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  return Boolean(
    hasCoordinates ||
      String(location.label || "").trim() ||
      String(location.manualText || "").trim() ||
      String(location.mapsUrl || "").trim()
  );
}

function hasClientSignature(payload) {
  const imageDataUrl = String(payload?.signature?.imageDataUrl || "").trim();
  return imageDataUrl.startsWith("data:image/");
}

function hasServicePhoto(payload, field) {
  const imageDataUrl = String(payload?.[field]?.imageDataUrl || "").trim();
  return imageDataUrl.startsWith("data:image/");
}

function broadcastService(eventName, service, message, previousEmployeeIds = []) {
  io.to("admins").emit(eventName, { service, message });
  const employeeIds = new Set([...(service.employeeIds || []), ...previousEmployeeIds]);
  employeeIds.forEach((employeeId) => {
    io.to(`employee:${employeeId}`).emit(eventName, { service, message });
  });
}

function broadcastTeam(team, message, previousEmployeeIds = []) {
  io.to("admins").emit("team:updated", { team, message });
  const currentEmployeeIds = new Set(team.employeeIds || []);
  const previousIds = new Set(previousEmployeeIds || []);
  const employeeIds = new Set([...currentEmployeeIds, ...previousIds]);
  employeeIds.forEach((employeeId) => {
    let personalMessage = message;
    if (currentEmployeeIds.has(employeeId) && !previousIds.has(employeeId)) {
      personalMessage = `Você entrou na equipe ${team.name}.`;
    }
    if (!currentEmployeeIds.has(employeeId) && previousIds.has(employeeId)) {
      personalMessage = `Você saiu da equipe ${team.name}.`;
    }
    io.to(`employee:${employeeId}`).emit("team:updated", { team, message: personalMessage });
  });
}

function emitDashboard() {
  io.to("admins").emit("dashboard:updated", store.dashboard());
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    appName: config.APP_NAME,
    publicUrl: config.PUBLIC_URL,
    frontendUrl: config.FRONTEND_URL,
    nodeEnv: config.NODE_ENV,
    storage: config.DB_CLIENT,
    dataFile: store.DATA_FILE,
    postgresTable: config.DB_CLIENT === "postgres" ? config.DB_STORAGE_TABLE : null
  });
});

app.post("/api/auth/admin", (req, res) => {
  const { email, password } = req.body || {};
  const admin = store.findAdminByEmail(email);
  if (!admin || !store.verifySecret(password, admin.passwordSalt, admin.passwordHash)) {
    return res.status(401).json({ error: "E-mail ou senha invalidos." });
  }

  const user = store.publicAdmin(admin);
  const token = makeToken(user);
  res.json({ token, user });
});

app.post("/api/auth/employee", (req, res) => {
  const { pin } = req.body || {};
  const employee = store.findEmployeeByPin(pin);
  if (!employee) {
    return res.status(401).json({ error: "PIN inválido ou funcionário inativo." });
  }

  const user = { ...store.publicEmployee(employee), role: "employee" };
  const token = makeToken(user);
  res.json({ token, user });
});

app.post("/api/admin/emergency-reset", asyncRoute(async (req, res) => {
  if (!config.ADMIN_RESET_TOKEN) {
    return res.status(404).json({ error: "Reset emergencial desativado." });
  }

  const token = String(req.body?.token || req.headers["x-admin-reset-token"] || "").trim();
  if (token !== config.ADMIN_RESET_TOKEN) {
    return res.status(403).json({ error: "Token de reset invalido." });
  }

  const password = String(req.body?.password || "").trim();
  if (password.length < 6) {
    return res.status(400).json({ error: "A nova senha precisa ter pelo menos 6 caracteres." });
  }

  const email = String(req.body?.email || "admin@egautomacoes.local").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Informe um e-mail valido." });
  }

  const user = await store.emergencyResetAdmin({
    name: req.body?.name,
    email,
    password
  });

  if (!user) return res.status(404).json({ error: "Administrador não encontrado." });
  res.json({ ok: true, user });
}));

app.post("/api/auth/logout", auth(), (req, res) => {
  tokens.delete(req.token);
  res.json({ ok: true });
});

app.get("/api/me", auth(), (req, res) => {
  res.json({ user: req.user });
});

app.patch("/api/admin/account", auth("admin"), asyncRoute(async (req, res) => {
  const { name, email, currentPassword, newPassword, confirmPassword } = req.body || {};
  const nextEmail = String(email || "").trim().toLowerCase();
  const nextPassword = String(newPassword || "").trim();

  if (!String(currentPassword || "").trim()) {
    return res.status(400).json({ error: "Informe a senha atual." });
  }
  if (!String(name || "").trim()) {
    return res.status(400).json({ error: "Informe o nome do administrador." });
  }
  if (!nextEmail || !nextEmail.includes("@")) {
    return res.status(400).json({ error: "Informe um e-mail valido." });
  }
  if (nextPassword && nextPassword.length < 6) {
    return res.status(400).json({ error: "A nova senha precisa ter pelo menos 6 caracteres." });
  }
  if (nextPassword && nextPassword !== String(confirmPassword || "")) {
    return res.status(400).json({ error: "A confirmação da senha não confere." });
  }

  const user = await store.updateAdminAccount(req.user.id, {
    name,
    email: nextEmail,
    currentPassword,
    newPassword: nextPassword
  });

  if (!user) return res.status(404).json({ error: "Administrador não encontrado." });
  if (user.invalidPassword) return res.status(401).json({ error: "Senha atual invalida." });
  if (user.emailTaken) return res.status(409).json({ error: "Ja existe outro admin com esse e-mail." });

  const session = getSession(req.token);
  if (session) {
    session.name = user.name;
    session.email = user.email;
  }

  res.json({ user });
}));

app.get("/api/dashboard", auth("admin"), (_req, res) => {
  res.json(store.dashboard());
});

app.get("/api/employees", auth("admin"), (_req, res) => {
  res.json(store.db.employees.filter((employee) => !employee.deletedAt).map(store.adminEmployee));
});

app.get("/api/teams", auth("admin"), (_req, res) => {
  const teams = store.db.teams
    .filter((team) => !team.deletedAt)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map(store.publicTeam);
  res.json(teams);
});

app.get("/api/my-teams", auth("employee"), (req, res) => {
  res.json(store.listTeamsForEmployee(req.user.id));
});

app.post("/api/teams", auth("admin"), asyncRoute(async (req, res) => {
  const validation = validateTeamPayload(req.body || {});
  if (validation) return res.status(400).json({ error: validation });

  const team = await store.createTeam(req.body || {});
  broadcastTeam(team, `Você entrou na equipe ${team.name}.`);
  emitDashboard();
  res.status(201).json(team);
}));

app.patch("/api/teams/:id", auth("admin"), asyncRoute(async (req, res) => {
  const current = store.db.teams.find((team) => team.id === req.params.id);
  if (!current) return res.status(404).json({ error: "Equipe não encontrada." });
  const previousEmployeeIds = current.employeeIds.slice();
  const validation = validateTeamPayload({
    name: req.body?.name ?? current.name,
    leaderId: req.body?.leaderId ?? current.leaderId,
    employeeIds: req.body?.employeeIds ?? current.employeeIds
  });
  if (validation) return res.status(400).json({ error: validation });

  const team = await store.updateTeam(req.params.id, req.body || {});
  broadcastTeam(team, `Equipe ${team.name} atualizada.`, previousEmployeeIds);
  const serviceUpdates = await store.syncTeamServices(team.id);
  serviceUpdates.forEach(({ service, previousEmployeeIds: serviceEmployeeIds }) => {
    broadcastService("service:updated", service, `Serviço ${service.code} atualizado pela equipe ${team.name}.`, serviceEmployeeIds);
  });
  emitDashboard();
  res.json(team);
}));

app.delete("/api/teams/:id", auth("admin"), asyncRoute(async (req, res) => {
  const result = await store.deleteTeam(req.params.id);
  if (!result) return res.status(404).json({ error: "Equipe não encontrada." });
  if (result.blocked) {
    return res.status(409).json({
      error: "Não é possível excluir equipe com serviço agendado ou iniciado.",
      services: result.services
    });
  }

  broadcastTeam(result.team, `Equipe ${result.team.name} excluída.`, result.previousEmployeeIds);
  emitDashboard();
  res.json(result.team);
}));

app.get("/api/clients", auth("admin"), (_req, res) => {
  const clients = store.db.clients
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map(store.publicClient);
  res.json(clients);
});

app.post("/api/clients", auth("admin"), asyncRoute(async (req, res) => {
  const { name } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "Informe o nome do cliente." });

  const client = await store.createClient(req.body || {});
  io.to("admins").emit("client:updated", { client, message: "Cliente cadastrado." });
  emitDashboard();
  res.status(201).json(client);
}));

app.patch("/api/clients/:id", auth("admin"), asyncRoute(async (req, res) => {
  const client = await store.updateClient(req.params.id, req.body || {});
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

  io.to("admins").emit("client:updated", { client, message: "Cliente atualizado." });
  emitDashboard();
  res.json(client);
}));

app.get("/api/materials", auth("admin"), (_req, res) => {
  const materials = store.db.materials
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR"))
    .map(store.publicMaterial);
  res.json(materials);
});

app.get("/api/materials/lookup", auth("admin"), (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) return res.status(400).json({ error: "Informe o código do material." });
  const material = store.findMaterialByCode(code);
  if (!material || !material.active) return res.status(404).json({ error: "Material não encontrado ou inativo." });
  res.json(store.publicMaterial(material));
});

app.post("/api/materials", auth("admin"), asyncRoute(async (req, res) => {
  const { code, name } = req.body || {};
  if (!String(code || "").trim()) return res.status(400).json({ error: "Informe o código do material." });
  if (!String(name || "").trim()) return res.status(400).json({ error: "Informe o nome do material." });
  const existing = store.findMaterialByCode(code);
  if (existing) return res.status(409).json({ error: "Já existe um material com esse código." });

  const material = await store.createMaterial(req.body || {});
  io.to("admins").emit("material:updated", { material, message: "Material cadastrado." });
  res.status(201).json(material);
}));

app.patch("/api/materials/:id", auth("admin"), asyncRoute(async (req, res) => {
  if (req.body?.code) {
    const existing = store.findMaterialByCode(req.body.code);
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: "Já existe outro material com esse código." });
    }
  }
  const material = await store.updateMaterial(req.params.id, req.body || {});
  if (!material) return res.status(404).json({ error: "Material não encontrado." });

  io.to("admins").emit("material:updated", { material, message: "Material atualizado." });
  res.json(material);
}));

app.post("/api/employees", auth("admin"), asyncRoute(async (req, res) => {
  const { name, phone, pin } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "Informe o nome do funcionário." });
  if (!String(pin || "").trim()) return res.status(400).json({ error: "Informe o PIN do funcionário." });

  const employee = await store.createEmployee({ name, phone, pin });
  io.to("admins").emit("employee:updated", { employee, message: "Funcionário cadastrado." });
  emitDashboard();
  res.status(201).json(employee);
}));

app.patch("/api/employees/:id", auth("admin"), asyncRoute(async (req, res) => {
  const employee = await store.updateEmployee(req.params.id, req.body || {});
  if (!employee) return res.status(404).json({ error: "Funcionário não encontrado." });

  io.to("admins").emit("employee:updated", { employee, message: "Funcionário atualizado." });
  emitDashboard();
  res.json(employee);
}));

app.delete("/api/employees/:id", auth("admin"), asyncRoute(async (req, res) => {
  const result = await store.deleteEmployee(req.params.id);
  if (!result) return res.status(404).json({ error: "Funcionário não encontrado." });
  if (result.blocked) {
    return res.status(409).json({
      error: "Não é possível excluir funcionário com serviço agendado ou iniciado.",
      services: result.services
    });
  }

  io.to("admins").emit("employee:updated", { employee: result.employee, message: "Funcionário excluído." });
  io.to("admins").emit("team:updated", { team: null, message: "Equipes atualizadas." });
  emitDashboard();
  res.json(result.employee);
}));

app.get("/api/services", auth(), (req, res) => {
  res.json(store.listServicesFor(req.user, req.query || {}));
});

app.post("/api/services", auth("admin"), asyncRoute(async (req, res) => {
  const validation = validateService(req.body || {});
  if (validation) return res.status(400).json({ error: validation });

  const service = await store.createService(req.body, req.user.id);
  const message = service.team
    ? `Novo serviço ${service.code} enviado para a equipe ${service.team.name}.`
    : `Novo serviço ${service.code} enviado.`;
  broadcastService("service:created", service, message);
  emitDashboard();
  res.status(201).json(service);
}));

app.patch("/api/services/:id", auth("admin"), asyncRoute(async (req, res) => {
  const validation = validateService({ ...req.body, employeeIds: req.body.employeeIds || [] });
  if (validation) return res.status(400).json({ error: validation });

  const current = store.db.services.find((service) => service.id === req.params.id);
  const previousEmployeeIds = current ? current.employeeIds.slice() : [];
  const result = await store.updateService(req.params.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Serviço não encontrado." });
  if (result.locked) return res.status(409).json({ error: "Serviço finalizado não pode ser alterado.", service: result.service });

  broadcastService("service:updated", result, `Serviço ${result.code} atualizado.`, previousEmployeeIds);
  emitDashboard();
  res.json(result);
}));

app.post("/api/services/:id/cancel", auth("admin"), asyncRoute(async (req, res) => {
  const result = await store.cancelService(req.params.id);
  if (!result) return res.status(404).json({ error: "Serviço não encontrado." });
  if (result.locked) return res.status(409).json({ error: "Serviço finalizado não pode ser cancelado.", service: result.service });

  broadcastService("service:updated", result, `Serviço ${result.code} cancelado.`);
  emitDashboard();
  res.json(result);
}));

app.post("/api/services/:id/start", auth("employee"), asyncRoute(async (req, res) => {
  if (!hasLocationProof(req.body || {}, "startLocation")) {
    return res.status(400).json({ error: "Informe a localização de início antes de iniciar." });
  }
  if (!hasServicePhoto(req.body || {}, "beforePhoto")) {
    return res.status(400).json({ error: "Tire ou anexe a foto de antes antes de iniciar." });
  }
  const result = await store.startService(req.params.id, req.user.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Serviço não encontrado." });
  if (result.forbidden) return res.status(403).json({ error: "Serviço não atribuído a este funcionário." });
  if (result.notTeamLeader) return res.status(403).json({ error: "Apenas o líder da equipe pode iniciar este serviço.", service: result.service });
  if (result.invalidStatus) return res.status(409).json({ error: "Serviço não está disponível para iniciar.", service: result.service });

  broadcastService("service:updated", result, `${req.user.name} iniciou ${result.code}.`);
  emitDashboard();
  res.json(result);
}));

app.post("/api/services/:id/finish", auth("employee"), asyncRoute(async (req, res) => {
  if (!hasLocationProof(req.body || {}, "finalLocation")) {
    return res.status(400).json({ error: "Informe a localização final antes de finalizar." });
  }
  if (!hasClientSignature(req.body || {})) {
    return res.status(400).json({ error: "Colete a assinatura do cliente antes de finalizar." });
  }
  if (!hasServicePhoto(req.body || {}, "afterPhoto")) {
    return res.status(400).json({ error: "Tire ou anexe a foto de depois antes de finalizar." });
  }
  const result = await store.finishService(req.params.id, req.user.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Serviço não encontrado." });
  if (result.forbidden) return res.status(403).json({ error: "Serviço não atribuído a este funcionário." });
  if (result.notTeamLeader) return res.status(403).json({ error: "Apenas o líder da equipe pode finalizar este serviço.", service: result.service });
  if (result.invalidStatus) return res.status(409).json({ error: "Serviço precisa estar iniciado antes de finalizar.", service: result.service });

  broadcastService("service:updated", result, `${req.user.name} finalizou ${result.code}.`);
  emitDashboard();
  res.json(result);
}));

app.patch("/api/services/:id/price", auth("admin"), asyncRoute(async (req, res) => {
  const result = await store.priceService(req.params.id, req.user.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Serviço não encontrado." });
  if (result.invalidStatus) return res.status(409).json({ error: "Serviço precisa estar finalizado para receber preço.", service: result.service });
  if (result.invalidPrice) return res.status(400).json({ error: "Informe um valor maior que zero.", service: result.service });

  broadcastService("service:updated", result, `Preço do serviço ${result.code} definido.`);
  emitDashboard();
  res.json(result);
}));

app.post("/api/services/:id/sent-to-client", auth("admin"), asyncRoute(async (req, res) => {
  const result = await store.markServiceSentToClient(req.params.id, req.user.id, req.body || {});
  if (!result) return res.status(404).json({ error: "Serviço não encontrado." });
  if (result.invalidStatus) {
    return res.status(409).json({ error: "Defina o preço antes de marcar como enviado ao cliente.", service: result.service });
  }

  broadcastService("service:updated", result, `Serviço ${result.code} enviado ao cliente.`);
  emitDashboard();
  res.json(result);
}));

app.post("/api/reports/client-pdf", auth("admin"), asyncRoute(async (req, res) => {
  const clientId = String(req.body?.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "Selecione um cliente para gerar o relatório." });

  const result = await reports.createClientReportPdf({
    db: store.db,
    clientId,
    filters: req.body?.filters || {},
    options: req.body?.options || {}
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.send(result.buffer);
}));

app.post("/api/reports/service-pdf", auth("admin"), asyncRoute(async (req, res) => {
  const serviceId = String(req.body?.serviceId || "").trim();
  if (!serviceId) return res.status(400).json({ error: "Selecione um serviço para gerar o PDF." });

  const result = await reports.createServiceReportPdf({
    db: store.db,
    serviceId,
    options: req.body?.options || {}
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
  res.send(result.buffer);
}));

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.statusCode || 500).json({ error: error.message || "Erro interno do servidor." });
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  const user = token ? getSession(token) : null;
  if (!user) return next(new Error("Sessao invalida."));
  socket.data.user = user;
  next();
});

io.on("connection", (socket) => {
  const user = socket.data.user;
  if (user.role === "admin") {
    socket.join("admins");
    socket.emit("dashboard:updated", store.dashboard());
  } else {
    socket.join(`employee:${user.id}`);
  }
});

async function start() {
  await store.init();
  server.listen(config.PORT, config.HOST, () => {
    console.log(`${config.APP_NAME} rodando em ${config.PUBLIC_URL || `http://localhost:${config.PORT}`}`);
    console.log(`Node escutando em http://${config.HOST}:${config.PORT}`);
    console.log(`Armazenamento atual: ${config.DB_CLIENT} (${config.DB_CLIENT === "postgres" ? config.DB_STORAGE_TABLE : store.DATA_FILE})`);
    console.log("Admin inicial: admin@egautomacoes.local / admin123");
  });
}

async function shutdown() {
  await store.close();
}

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

start().catch((error) => {
  console.error("Falha ao iniciar servidor:", error);
  process.exit(1);
});
