const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");
const config = require("./config");

const DATA_DIR = config.DATA_DIR;
const DATA_FILE = config.DATA_FILE;
const STORAGE_KEY = "default";

let pgPool = null;

function sqlIdentifier(value) {
  const identifier = String(value || "").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Nome de tabela invalido para Postgres: ${identifier}`);
  }
  return `"${identifier}"`;
}

const STORAGE_TABLE = sqlIdentifier(config.DB_STORAGE_TABLE);

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(secret), salt, 64).toString("hex");
  return { salt, hash };
}

function verifySecret(secret, salt, expectedHash) {
  const { hash } = hashSecret(secret, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(expectedHash, "hex"));
}

function makeAdmin() {
  const password = hashSecret("admin123");
  return {
    id: id("admin"),
    role: "admin",
    name: "Administrador EG",
    email: "admin@egautomacoes.local",
    passwordSalt: password.salt,
    passwordHash: password.hash,
    createdAt: now()
  };
}

function makeEmployee(name, phone, pin) {
  const secret = hashSecret(pin);
  return {
    id: id("emp"),
    name,
    phone,
    pinSalt: secret.salt,
    pinHash: secret.hash,
    pinDisplay: normalizeText(pin),
    active: true,
    createdAt: now(),
    updatedAt: now()
  };
}

function makeClient({ name, contact, phone, email, address, notes }) {
  return {
    id: id("cli"),
    name: normalizeText(name),
    contact: normalizeText(contact),
    phone: normalizeText(phone),
    email: normalizeText(email),
    address: normalizeText(address),
    notes: normalizeText(notes),
    active: true,
    createdAt: now(),
    updatedAt: now()
  };
}

function makeMaterial({ code, name, unit, notes }) {
  return {
    id: id("mat"),
    code: normalizeCode(code),
    name: normalizeText(name),
    unit: normalizeText(unit) || "un",
    notes: normalizeText(notes),
    active: true,
    createdAt: now(),
    updatedAt: now()
  };
}

function makeTeam({ name, leaderId, employeeIds }) {
  const members = normalizeEmployeeIds(employeeIds);
  return {
    id: id("team"),
    name: normalizeText(name),
    leaderId: normalizeText(leaderId),
    employeeIds: members,
    active: true,
    createdAt: now(),
    updatedAt: now()
  };
}

function seedData() {
  return {
    meta: {
      appName: config.APP_NAME,
      createdAt: now()
    },
    admins: [makeAdmin()],
    employees: [
      makeEmployee("Carlos Silva", "(11) 90000-1001", "1234"),
      makeEmployee("Marina Souza", "(11) 90000-1002", "5678")
    ],
    clients: [],
    materials: [],
    teams: [],
    services: [],
    events: []
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedData(), null, 2));
  }
}

function normalizeLoadedData(loaded) {
  if (!Array.isArray(loaded.clients)) loaded.clients = [];
  if (!Array.isArray(loaded.materials)) loaded.materials = [];
  if (!Array.isArray(loaded.teams)) loaded.teams = [];
  if (!Array.isArray(loaded.events)) loaded.events = [];
  if (!Array.isArray(loaded.employees)) loaded.employees = [];
  loaded.employees.forEach((employee) => {
    if (!("pinDisplay" in employee)) {
      if (employee.pinSalt && employee.pinHash && verifySecret("1234", employee.pinSalt, employee.pinHash)) {
        employee.pinDisplay = "1234";
      } else if (employee.pinSalt && employee.pinHash && verifySecret("5678", employee.pinSalt, employee.pinHash)) {
        employee.pinDisplay = "5678";
      } else {
        employee.pinDisplay = "";
      }
    }
  });
  if (!Array.isArray(loaded.services)) loaded.services = [];
  loaded.services.forEach((service) => {
    if (!("clientId" in service)) service.clientId = null;
    if (!("teamId" in service)) service.teamId = null;
    service.price = normalizeServicePrice(service.price ?? service.serviceValue ?? service.value);
    if (!["PENDING", "PRICED"].includes(service.priceStatus)) {
      service.priceStatus = service.status === "done" && service.price > 0 ? "PRICED" : "PENDING";
    }
    if (!("financeNotes" in service)) service.financeNotes = "";
    if (!("pricedAt" in service)) service.pricedAt = service.priceStatus === "PRICED" ? service.updatedAt || service.finishedAt || null : null;
    if (!("pricedBy" in service)) service.pricedBy = null;
    if (!Array.isArray(service.materials)) service.materials = [];
    if (!("startLocation" in service)) service.startLocation = null;
    if (!("finalLocation" in service)) service.finalLocation = null;
    if (!("clientSignature" in service)) service.clientSignature = null;
    if (!service.servicePhotos || typeof service.servicePhotos !== "object") {
      service.servicePhotos = { before: null, after: null };
    }
    if (!("before" in service.servicePhotos)) service.servicePhotos.before = null;
    if (!("after" in service.servicePhotos)) service.servicePhotos.after = null;
    if (!("reportPreference" in service)) service.reportPreference = null;
  });
  return loaded;
}

function loadJson() {
  ensureDataFile();
  return normalizeLoadedData(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
}

async function loadPostgres() {
  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL e obrigatorio quando DB_CLIENT=postgres.");
  }

  pgPool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined
  });

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS ${STORAGE_TABLE} (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const result = await pgPool.query(`SELECT data FROM ${STORAGE_TABLE} WHERE id = $1`, [STORAGE_KEY]);
  if (result.rowCount > 0) return normalizeLoadedData(result.rows[0].data);

  const seeded = seedData();
  await savePostgres(seeded);
  return seeded;
}

async function load() {
  if (config.DB_CLIENT === "json") return loadJson();
  if (config.DB_CLIENT === "postgres") return loadPostgres();
  throw new Error(`DB_CLIENT=${config.DB_CLIENT} nao suportado. Use json ou postgres.`);
}

async function savePostgres(nextDb) {
  await pgPool.query(
    `
      INSERT INTO ${STORAGE_TABLE} (id, data, updated_at)
      VALUES ($1, $2::jsonb, now())
      ON CONFLICT (id)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `,
    [STORAGE_KEY, JSON.stringify(nextDb)]
  );
}

async function save(nextDb) {
  if (config.DB_CLIENT === "postgres") {
    await savePostgres(nextDb);
    return;
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(nextDb, null, 2));
}

let db = null;

async function init() {
  db = await load();
  return db;
}

async function close() {
  if (pgPool) await pgPool.end();
}

function publicEmployee(employee) {
  return {
    id: employee.id,
    name: employee.name,
    phone: employee.phone,
    active: employee.active,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt
  };
}

function adminEmployee(employee) {
  return {
    ...publicEmployee(employee),
    pin: employee.pinDisplay || "",
    hasVisiblePin: Boolean(employee.pinDisplay)
  };
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    contact: client.contact,
    phone: client.phone,
    email: client.email,
    address: client.address,
    notes: client.notes,
    active: client.active,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt
  };
}

function publicMaterial(material) {
  return {
    id: material.id,
    code: material.code,
    name: material.name,
    unit: material.unit,
    notes: material.notes,
    active: material.active,
    createdAt: material.createdAt,
    updatedAt: material.updatedAt
  };
}

function publicTeam(team) {
  const employees = team.employeeIds
    .map((employeeId) => db.employees.find((employee) => employee.id === employeeId))
    .filter(Boolean)
    .map(publicEmployee);
  const leader = db.employees.find((employee) => employee.id === team.leaderId);

  return {
    id: team.id,
    name: team.name,
    leaderId: team.leaderId,
    leader: leader ? publicEmployee(leader) : null,
    employeeIds: team.employeeIds,
    employees,
    active: team.active,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt
  };
}

function publicAdmin(admin) {
  return {
    id: admin.id,
    role: "admin",
    name: admin.name,
    email: admin.email
  };
}

function publicService(service) {
  const client = service.clientId
    ? db.clients.find((item) => item.id === service.clientId)
    : null;
  const team = service.teamId
    ? db.teams.find((item) => item.id === service.teamId)
    : null;

  return {
    ...service,
    client: client ? publicClient(client) : null,
    team: team ? publicTeam(team) : null,
    employees: service.employeeIds
      .map((employeeId) => db.employees.find((employee) => employee.id === employeeId))
      .filter(Boolean)
      .map(publicEmployee)
  };
}

async function addEvent(type, message, details = {}) {
  const event = {
    id: id("evt"),
    type,
    message,
    details,
    createdAt: now()
  };
  db.events.unshift(event);
  db.events = db.events.slice(0, 120);
  await save(db);
  return event;
}

function nextServiceCode() {
  const currentYear = new Date().getFullYear();
  const number = db.services.length + 1;
  return `EG-${currentYear}-${String(number).padStart(4, "0")}`;
}

function dashboard() {
  const total = db.services.length;
  const scheduled = db.services.filter((service) => service.status === "scheduled").length;
  const inProgress = db.services.filter((service) => service.status === "in_progress").length;
  const done = db.services.filter((service) => service.status === "done").length;
  const cancelled = db.services.filter((service) => service.status === "cancelled").length;
  const activeEmployees = db.employees.filter((employee) => employee.active).length;
  const clients = db.clients.length;
  const materials = db.materials.length;
  const teams = db.teams.length;

  return {
    total,
    scheduled,
    inProgress,
    done,
    cancelled,
    clients,
    materials,
    teams,
    activeEmployees,
    recentEvents: db.events.slice(0, 12)
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeServicePrice(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0;
  }

  let text = normalizeText(value).replace(/[^\d,.-]/g, "");
  if (!text) return 0;
  if (text.includes(",") && text.includes(".")) text = text.replaceAll(".", "").replace(",", ".");
  else if (text.includes(",")) text = text.replace(",", ".");

  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
}

function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

function findAdminByEmail(email) {
  const normalized = normalizeText(email).toLowerCase();
  return db.admins.find((admin) => admin.email.toLowerCase() === normalized);
}

async function updateAdminAccount(adminId, payload = {}) {
  const admin = db.admins.find((item) => item.id === adminId);
  if (!admin) return null;

  const currentPassword = normalizeText(payload.currentPassword);
  if (!currentPassword || !verifySecret(currentPassword, admin.passwordSalt, admin.passwordHash)) {
    return { invalidPassword: true };
  }

  if (payload.name !== undefined) {
    const nextName = normalizeText(payload.name);
    if (nextName) admin.name = nextName;
  }

  if (payload.email !== undefined) {
    const nextEmail = normalizeText(payload.email).toLowerCase();
    const existing = db.admins.find((item) => item.id !== admin.id && item.email.toLowerCase() === nextEmail);
    if (existing) return { emailTaken: true };
    if (nextEmail) admin.email = nextEmail;
  }

  if (payload.newPassword) {
    const secret = hashSecret(normalizeText(payload.newPassword));
    admin.passwordSalt = secret.salt;
    admin.passwordHash = secret.hash;
  }

  admin.updatedAt = now();
  await save(db);
  await addEvent("admin.updated", `Acesso admin ${admin.email} atualizado.`, { adminId: admin.id });
  return publicAdmin(admin);
}

async function emergencyResetAdmin(payload = {}) {
  const admin = db.admins[0];
  if (!admin) return null;

  const nextEmail = normalizeText(payload.email).toLowerCase() || "admin@egautomacoes.local";
  const nextPassword = normalizeText(payload.password) || "admin123";
  const nextName = normalizeText(payload.name) || admin.name || "Administrador EG";
  const secret = hashSecret(nextPassword);

  admin.name = nextName;
  admin.email = nextEmail;
  admin.passwordSalt = secret.salt;
  admin.passwordHash = secret.hash;
  admin.updatedAt = now();

  await save(db);
  await addEvent("admin.emergency_reset", `Acesso admin ${admin.email} resetado.`, { adminId: admin.id });
  return publicAdmin(admin);
}

function findEmployeeByPin(pin) {
  return db.employees.find((employee) => {
    if (!employee.active) return false;
    return verifySecret(pin, employee.pinSalt, employee.pinHash);
  });
}

function normalizeEmployeeIds(employeeIds) {
  return Array.from(new Set(Array.isArray(employeeIds) ? employeeIds.map(normalizeText).filter(Boolean) : []));
}

async function createEmployee({ name, phone, pin }) {
  const employee = makeEmployee(normalizeText(name), normalizeText(phone), normalizeText(pin));
  db.employees.push(employee);
  await save(db);
  await addEvent("employee.created", `FuncionÃ¡rio ${employee.name} cadastrado.`, { employeeId: employee.id });
  return adminEmployee(employee);
}

async function createClient(payload) {
  const client = makeClient(payload);
  db.clients.push(client);
  await save(db);
  await addEvent("client.created", `Cliente ${client.name} cadastrado.`, { clientId: client.id });
  return publicClient(client);
}

async function createMaterial(payload) {
  const material = makeMaterial(payload);
  db.materials.push(material);
  await save(db);
  await addEvent("material.created", `Material ${material.code} cadastrado.`, { materialId: material.id });
  return publicMaterial(material);
}

async function updateMaterial(materialId, payload) {
  const material = db.materials.find((item) => item.id === materialId);
  if (!material) return null;

  if (payload.code !== undefined) material.code = normalizeCode(payload.code);
  if (payload.name !== undefined) material.name = normalizeText(payload.name);
  if (payload.unit !== undefined) material.unit = normalizeText(payload.unit) || "un";
  if (payload.notes !== undefined) material.notes = normalizeText(payload.notes);
  if (payload.active !== undefined) material.active = Boolean(payload.active);
  material.updatedAt = now();
  await save(db);
  await addEvent("material.updated", `Material ${material.code} atualizado.`, { materialId: material.id });
  return publicMaterial(material);
}

function findMaterialByCode(code) {
  const normalized = normalizeCode(code);
  return db.materials.find((material) => material.code === normalized);
}

async function createTeam(payload) {
  const team = makeTeam(payload);
  db.teams.push(team);
  await save(db);
  await addEvent("team.created", `Equipe ${team.name} cadastrada.`, { teamId: team.id, employeeIds: team.employeeIds });
  return publicTeam(team);
}

async function updateTeam(teamId, payload) {
  const team = db.teams.find((item) => item.id === teamId);
  if (!team) return null;

  if (payload.name !== undefined) team.name = normalizeText(payload.name);
  if (payload.employeeIds !== undefined) team.employeeIds = normalizeEmployeeIds(payload.employeeIds);
  if (payload.leaderId !== undefined) team.leaderId = normalizeText(payload.leaderId);
  if (payload.active !== undefined) team.active = Boolean(payload.active);
  team.updatedAt = now();
  await save(db);
  await addEvent("team.updated", `Equipe ${team.name} atualizada.`, { teamId: team.id, employeeIds: team.employeeIds });
  return publicTeam(team);
}

function listTeamsForEmployee(employeeId) {
  return db.teams
    .filter((team) => team.active && team.employeeIds.includes(employeeId))
    .map(publicTeam);
}

async function syncTeamServices(teamId) {
  const team = db.teams.find((item) => item.id === teamId && item.active);
  if (!team) return [];

  const updates = [];
  db.services.forEach((service) => {
    if (service.teamId !== team.id || ["done", "cancelled"].includes(service.status)) return;
    const previousEmployeeIds = service.employeeIds.slice();
    const nextEmployeeIds = team.employeeIds.slice();
    const changed =
      previousEmployeeIds.length !== nextEmployeeIds.length ||
      previousEmployeeIds.some((employeeId, index) => employeeId !== nextEmployeeIds[index]);

    if (!changed) return;
    service.employeeIds = nextEmployeeIds;
    service.updatedAt = now();
    updates.push({ service: publicService(service), previousEmployeeIds });
  });

  if (updates.length) {
    await save(db);
    await addEvent("team.services_synced", `Servicos da equipe ${team.name} atualizados.`, { teamId: team.id });
  }
  return updates;
}

async function updateClient(clientId, payload) {
  const client = db.clients.find((item) => item.id === clientId);
  if (!client) return null;

  const fields = ["name", "contact", "phone", "email", "address", "notes"];
  fields.forEach((field) => {
    if (payload[field] !== undefined) client[field] = normalizeText(payload[field]);
  });
  if (payload.active !== undefined) client.active = Boolean(payload.active);
  client.updatedAt = now();
  await save(db);
  await addEvent("client.updated", `Cliente ${client.name} atualizado.`, { clientId: client.id });
  return publicClient(client);
}

async function updateEmployee(employeeId, payload) {
  const employee = db.employees.find((item) => item.id === employeeId);
  if (!employee) return null;

  if (payload.name !== undefined) employee.name = normalizeText(payload.name);
  if (payload.phone !== undefined) employee.phone = normalizeText(payload.phone);
  if (payload.active !== undefined) employee.active = Boolean(payload.active);
  if (payload.pin) {
    const nextPin = normalizeText(payload.pin);
    const secret = hashSecret(nextPin);
    employee.pinSalt = secret.salt;
    employee.pinHash = secret.hash;
    employee.pinDisplay = nextPin;
  }
  employee.updatedAt = now();
  await save(db);
  await addEvent("employee.updated", `FuncionÃ¡rio ${employee.name} atualizado.`, { employeeId: employee.id });
  return adminEmployee(employee);
}

async function deleteEmployee(employeeId) {
  const employee = db.employees.find((item) => item.id === employeeId && !item.deletedAt);
  if (!employee) return null;

  const openServices = db.services.filter(
    (service) => ["scheduled", "in_progress"].includes(service.status) && service.employeeIds.includes(employeeId)
  );
  if (openServices.length) {
    return { blocked: true, services: openServices.map(publicService) };
  }

  employee.active = false;
  employee.deletedAt = now();
  employee.updatedAt = now();

  db.teams.forEach((team) => {
    if (team.deletedAt || !team.employeeIds.includes(employeeId)) return;
    team.employeeIds = team.employeeIds.filter((id) => id !== employeeId);
    if (team.leaderId === employeeId) team.leaderId = team.employeeIds[0] || "";
    if (!team.employeeIds.length) team.active = false;
    team.updatedAt = now();
  });

  await save(db);
  await addEvent("employee.deleted", `Funcionario ${employee.name} excluido.`, { employeeId: employee.id });
  return { employee: adminEmployee(employee) };
}

async function deleteTeam(teamId) {
  const team = db.teams.find((item) => item.id === teamId && !item.deletedAt);
  if (!team) return null;

  const openServices = db.services.filter(
    (service) => ["scheduled", "in_progress"].includes(service.status) && service.teamId === teamId
  );
  if (openServices.length) {
    return { blocked: true, services: openServices.map(publicService) };
  }

  const previousEmployeeIds = team.employeeIds.slice();
  team.active = false;
  team.deletedAt = now();
  team.updatedAt = now();
  team.leaderId = "";
  team.employeeIds = [];

  await save(db);
  await addEvent("team.deleted", `Equipe ${team.name} excluida.`, { teamId: team.id });
  return { team: publicTeam(team), previousEmployeeIds };
}

function serviceMatchesFilters(service, filters = {}) {
  const status = normalizeText(filters.status);
  const clientId = normalizeText(filters.clientId);
  const dateFrom = normalizeText(filters.dateFrom);
  const dateTo = normalizeText(filters.dateTo);
  const teamId = normalizeText(filters.teamId);

  if (status && status !== "all" && service.status !== status) return false;
  if (clientId && service.clientId !== clientId) return false;
  if (teamId && service.teamId !== teamId) return false;
  if (dateFrom && service.date < dateFrom) return false;
  if (dateTo && service.date > dateTo) return false;
  return true;
}

function listServicesFor(user, filters = {}) {
  const services = user.role === "admin"
    ? db.services
    : db.services.filter((service) => service.employeeIds.includes(user.id));

  return services
    .filter((service) => user.role === "admin" ? serviceMatchesFilters(service, filters) : true)
    .slice()
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .map(publicService);
}

function normalizeServiceMaterials(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const code = normalizeCode(item.code);
      if (!code) return null;
      const material = item.materialId
        ? db.materials.find((candidate) => candidate.id === item.materialId)
        : findMaterialByCode(code);
      const quantity = Number(item.quantity);
      const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

      return {
        id: id("svc_mat"),
        materialId: material?.id || null,
        code,
        name: normalizeText(item.name) || material?.name || code,
        unit: normalizeText(item.unit) || material?.unit || "un",
        quantity: safeQuantity,
        notes: normalizeText(item.notes)
      };
    })
    .filter(Boolean);
}

async function createService(payload, adminId) {
  const clientId = normalizeText(payload.clientId) || null;
  const client = clientId ? db.clients.find((item) => item.id === clientId) : null;
  const materials = normalizeServiceMaterials(payload.materials);
  const teamId = normalizeText(payload.teamId) || null;
  const team = teamId ? db.teams.find((item) => item.id === teamId && item.active) : null;
  const employeeIds = team ? team.employeeIds : normalizeEmployeeIds(payload.employeeIds);
  const service = {
    id: id("svc"),
    code: nextServiceCode(),
    title: normalizeText(payload.title),
    clientId,
    teamId,
    customer: normalizeText(payload.customer) || client?.name || "",
    date: normalizeText(payload.date),
    time: normalizeText(payload.time),
    location: normalizeText(payload.location),
    address: normalizeText(payload.address),
    notes: normalizeText(payload.notes),
    price: 0,
    priceStatus: "PENDING",
    financeNotes: "",
    pricedAt: null,
    pricedBy: null,
    materials,
    employeeIds,
    status: "scheduled",
    createdBy: adminId,
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    startedBy: null,
    startLocation: null,
    finishedAt: null,
    finishedBy: null,
    finalLocation: null,
    clientSignature: null,
    servicePhotos: {
      before: null,
      after: null
    },
    reportPreference: null,
    cancelledAt: null
  };

  db.services.push(service);
  await save(db);
  await addEvent("service.created", `ServiÃ§o ${service.code} enviado aos funcionÃ¡rios.`, {
    serviceId: service.id,
    employeeIds: service.employeeIds
  });
  return publicService(service);
}

async function updateService(serviceId, payload) {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) return null;
  if (service.status === "done") return { locked: true, service: publicService(service) };

  const fields = ["title", "customer", "date", "time", "location", "address", "notes"];
  fields.forEach((field) => {
    if (payload[field] !== undefined) service[field] = normalizeText(payload[field]);
  });
  if (payload.clientId !== undefined) service.clientId = normalizeText(payload.clientId) || null;
  if (payload.teamId !== undefined) {
    const teamId = normalizeText(payload.teamId) || null;
    const team = teamId ? db.teams.find((item) => item.id === teamId && item.active) : null;
    service.teamId = teamId;
    if (team) service.employeeIds = team.employeeIds;
  }
  if (payload.materials !== undefined) service.materials = normalizeServiceMaterials(payload.materials);
  if (!service.teamId && Array.isArray(payload.employeeIds)) service.employeeIds = normalizeEmployeeIds(payload.employeeIds);
  service.updatedAt = now();
  await save(db);
  await addEvent("service.updated", `ServiÃ§o ${service.code} atualizado.`, { serviceId: service.id });
  return publicService(service);
}

async function cancelService(serviceId) {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) return null;
  if (service.status === "done") return { locked: true, service: publicService(service) };

  service.status = "cancelled";
  service.cancelledAt = now();
  service.updatedAt = now();
  await save(db);
  await addEvent("service.cancelled", `ServiÃ§o ${service.code} cancelado.`, { serviceId: service.id });
  return publicService(service);
}

function normalizeLocation(location) {
  if (!location || typeof location !== "object") return null;

  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude);
  const label = normalizeText(location.label);
  const manualText = normalizeText(location.manualText);
  const mapsUrl = normalizeText(location.mapsUrl);

  if (!hasCoordinates && !label && !manualText && !mapsUrl) return null;

  const capturedAt = normalizeText(location.capturedAt) || now();

  if (hasCoordinates) {
    const accuracy = Number(location.accuracy);
    return {
      type: "gps",
      label: label || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
      latitude,
      longitude,
      accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      mapsUrl: mapsUrl || `https://www.google.com/maps?q=${latitude},${longitude}`,
      capturedAt
    };
  }

  return {
    type: "manual",
    label: label || manualText || mapsUrl,
    latitude: null,
    longitude: null,
    accuracy: null,
    mapsUrl,
    capturedAt
  };
}

function normalizeServicePhoto(photo, stage, employeeId) {
  if (!photo || typeof photo !== "object") return null;
  const imageDataUrl = normalizeText(photo.imageDataUrl);
  if (!imageDataUrl.startsWith("data:image/")) return null;

  const fallbackLabel = stage === "before" ? "Antes do servico" : "Depois do servico";
  return {
    stage,
    label: normalizeText(photo.label) || fallbackLabel,
    imageDataUrl,
    capturedAt: normalizeText(photo.capturedAt) || now(),
    capturedBy: employeeId,
    fileName: normalizeText(photo.fileName)
  };
}

function normalizeReportPreference(report, service, employeeId) {
  if (!report || typeof report !== "object") return null;
  const sendToClient = Boolean(report.sendToClient);
  const client = service.clientId ? db.clients.find((item) => item.id === service.clientId) : null;
  const clientEmail = normalizeText(report.clientEmail) || client?.email || "";

  return {
    sendToClient,
    clientEmail,
    requestedAt: now(),
    requestedBy: employeeId
  };
}

async function startService(serviceId, employeeId, payload = {}) {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) return null;
  if (!service.employeeIds.includes(employeeId)) return { forbidden: true };
  const team = service.teamId ? db.teams.find((item) => item.id === service.teamId) : null;
  if (team && team.leaderId !== employeeId) return { notTeamLeader: true, service: publicService(service) };
  if (service.status !== "scheduled") return { invalidStatus: true, service: publicService(service) };

  service.status = "in_progress";
  service.startedAt = now();
  service.startedBy = employeeId;
  service.startLocation = normalizeLocation(payload.startLocation);
  service.servicePhotos = service.servicePhotos || { before: null, after: null };
  service.servicePhotos.before = normalizeServicePhoto(payload.beforePhoto, "before", employeeId);
  service.updatedAt = now();
  await save(db);

  const employee = db.employees.find((item) => item.id === employeeId);
  await addEvent("service.started", `${employee?.name || "FuncionÃ¡rio"} iniciou ${service.code}.`, {
    serviceId: service.id,
    employeeId
  });
  return publicService(service);
}

function normalizeSignature(signature, service) {
  if (!signature || typeof signature !== "object") return null;
  const imageDataUrl = normalizeText(signature.imageDataUrl);
  if (!imageDataUrl.startsWith("data:image/")) return null;

  return {
    signerName: normalizeText(signature.signerName) || "Cliente",
    imageDataUrl,
    signedAt: now(),
    serviceType: service.title,
    serviceCode: service.code
  };
}

async function finishService(serviceId, employeeId, payload = {}) {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) return null;
  if (!service.employeeIds.includes(employeeId)) return { forbidden: true };
  const team = service.teamId ? db.teams.find((item) => item.id === service.teamId) : null;
  if (team && team.leaderId !== employeeId) return { notTeamLeader: true, service: publicService(service) };
  if (service.status !== "in_progress") return { invalidStatus: true, service: publicService(service) };

  service.status = "done";
  service.finishedAt = now();
  service.finishedBy = employeeId;
  service.finalLocation = normalizeLocation(payload.finalLocation);
  service.clientSignature = normalizeSignature(payload.signature, service);
  service.servicePhotos = service.servicePhotos || { before: null, after: null };
  service.servicePhotos.after = normalizeServicePhoto(payload.afterPhoto, "after", employeeId);
  service.reportPreference = normalizeReportPreference(payload.report, service, employeeId);
  if (service.priceStatus !== "PRICED") {
    service.price = 0;
    service.priceStatus = "PENDING";
    service.financeNotes = "";
    service.pricedAt = null;
    service.pricedBy = null;
  }
  service.updatedAt = now();
  await save(db);

  const employee = db.employees.find((item) => item.id === employeeId);
  await addEvent("service.finished", `${employee?.name || "FuncionÃ¡rio"} finalizou ${service.code}.`, {
    serviceId: service.id,
    employeeId
  });
  return publicService(service);
}

async function priceService(serviceId, adminId, payload = {}) {
  const service = db.services.find((item) => item.id === serviceId);
  if (!service) return null;
  if (service.status !== "done") return { invalidStatus: true, service: publicService(service) };

  const price = normalizeServicePrice(payload.price);
  if (price <= 0) return { invalidPrice: true, service: publicService(service) };

  service.price = price;
  service.priceStatus = "PRICED";
  service.financeNotes = normalizeText(payload.financeNotes);
  service.pricedAt = now();
  service.pricedBy = adminId;
  service.updatedAt = now();
  await save(db);

  await addEvent("service.priced", `Preco do servico ${service.code} definido.`, {
    serviceId: service.id,
    adminId,
    price
  });
  return publicService(service);
}

module.exports = {
  DATA_FILE,
  DATA_DIR,
  init,
  close,
  verifySecret,
  publicAdmin,
  publicEmployee,
  adminEmployee,
  publicClient,
  publicMaterial,
  publicTeam,
  publicService,
  dashboard,
  findAdminByEmail,
  updateAdminAccount,
  emergencyResetAdmin,
  findEmployeeByPin,
  createClient,
  updateClient,
  createMaterial,
  updateMaterial,
  findMaterialByCode,
  createTeam,
  updateTeam,
  deleteTeam,
  listTeamsForEmployee,
  syncTeamServices,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  listServicesFor,
  createService,
  updateService,
  cancelService,
  startService,
  finishService,
  priceService,
  get db() {
    if (!db) throw new Error("Store ainda nao inicializado.");
    return db;
  }
};

