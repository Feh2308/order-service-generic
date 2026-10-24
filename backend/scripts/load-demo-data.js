/* Carrega dados fictícios para apresentações. Não use este script em produção. */
const fs = require("fs");
const crypto = require("crypto");

const file = require("path").resolve(__dirname, "../data/db.json");
const db = JSON.parse(fs.readFileSync(file, "utf8"));
const now = new Date().toISOString();
const hash = (pin) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return { pinSalt: salt, pinHash: crypto.scryptSync(pin, salt, 64).toString("hex"), pinDisplay: pin };
};
const employee = (id, name, phone, pin) => ({ id, name, phone, ...hash(pin), active: true, createdAt: now, updatedAt: now });
const material = (id, code, name, unit, notes) => ({ id, code, name, unit, notes, active: true, createdAt: now, updatedAt: now });
const client = (id, name, contact, phone, address) => ({ id, name, contact, phone, email: `contato@${id}.demo`, address, notes: "Cadastro demonstrativo", active: true, createdAt: now, updatedAt: now });

if (db.admins?.[0]) {
  const adminPassword = hash("admin123");
  db.admins[0].name = "Administrador Demo";
  db.admins[0].email = "admin@exemplo.local";
  db.admins[0].passwordSalt = adminPassword.pinSalt;
  db.admins[0].passwordHash = adminPassword.pinHash;
}

db.employees = [
  employee("emp_demo_ana", "Ana Martins", "(11) 98888-1201", "1234"),
  employee("emp_demo_rafael", "Rafael Costa", "(11) 98888-1202", "5678"),
  employee("emp_demo_luiza", "Luiza Almeida", "(11) 98888-1203", "2468")
];
db.materials = [
  material("mat_demo_cabo", "MAT-001", "Cabo de conexão", "m", "Material demonstrativo"),
  material("mat_demo_sensor", "MAT-002", "Sensor de presença", "un", "Material demonstrativo"),
  material("mat_demo_fita", "MAT-003", "Fita de acabamento", "rolo", "Material demonstrativo")
];
db.clients = [
  client("cli_demo_novolar", "Nova Lar Serviços", "Beatriz Lima", "(11) 97777-4101", "Av. das Palmeiras, 240 - São Paulo/SP"),
  client("cli_demo_azul", "Grupo Horizonte", "Marcelo Nunes", "(11) 97777-4102", "Rua do Comércio, 88 - Campinas/SP"),
  client("cli_demo_ponto", "Ponto Central", "Carla Reis", "(11) 97777-4103", "Rua Central, 510 - Osasco/SP")
];
db.teams = [{ id: "team_demo_campo", name: "Equipe Campo A", leaderId: "emp_demo_ana", employeeIds: ["emp_demo_ana", "emp_demo_rafael"], active: true, createdAt: now, updatedAt: now }];
const template = db.services[0] || {};
const service = (id, code, title, customer, clientId, date, time, location, address, employeeIds, status, materials) => ({
  ...template, id, code, title, customer, clientId, teamId: "team_demo_campo", date, time, location, address,
  notes: "Ordem de serviço fictícia para apresentação", materials, employeeIds, status,
  createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, startLocation: null, finalLocation: null,
  servicePhotos: { before: null, after: null }, serviceUpdates: [], clientSignature: null
});
db.services = [
  service("svc_demo_001", "OS-2026-001", "Instalação de sensores", "Nova Lar Serviços", "cli_demo_novolar", "2026-08-12", "09:00", "Unidade Centro", "Av. das Palmeiras, 240 - São Paulo/SP", ["emp_demo_ana", "emp_demo_rafael"], "scheduled", [{ id: "svc_mat_001", materialId: "mat_demo_sensor", code: "MAT-002", name: "Sensor de presença", unit: "un", quantity: 6, notes: "" }]),
  service("svc_demo_002", "OS-2026-002", "Manutenção preventiva", "Grupo Horizonte", "cli_demo_azul", "2026-08-13", "14:30", "Escritório Administrativo", "Rua do Comércio, 88 - Campinas/SP", ["emp_demo_luiza"], "in_progress", [{ id: "svc_mat_002", materialId: "mat_demo_cabo", code: "MAT-001", name: "Cabo de conexão", unit: "m", quantity: 18, notes: "" }]),
  service("svc_demo_003", "OS-2026-003", "Ajuste de acabamento", "Ponto Central", "cli_demo_ponto", "2026-08-14", "08:30", "Loja Principal", "Rua Central, 510 - Osasco/SP", ["emp_demo_rafael"], "scheduled", [{ id: "svc_mat_003", materialId: "mat_demo_fita", code: "MAT-003", name: "Fita de acabamento", unit: "rolo", quantity: 2, notes: "" }])
];
db.meta = { ...(db.meta || {}), appName: "Order Service", demoData: true, updatedAt: now };
fs.writeFileSync(file, JSON.stringify(db, null, 2));
console.log("Dados fictícios carregados. Login admin: admin@exemplo.local / admin123");
console.log("PINs da equipe: Ana 1234, Rafael 5678, Luiza 2468");
