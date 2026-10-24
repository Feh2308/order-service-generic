const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

let serverProcess;
let baseUrl;
let dataDir;
let employeeToken;
let employeeId;
let adminToken;

async function getFreePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) throw new Error("Servidor de teste encerrou antes de iniciar.");
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Servidor de teste não iniciou no prazo.");
}

async function request(pathname, token, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "order-service-permissions-"));
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DB_CLIENT: "json", DATA_DIR: dataDir, PORT: String(port), HOST: "127.0.0.1" },
    stdio: "ignore"
  });
  await waitForServer();

  const employeeLogin = await request("/api/auth/employee", null, { method: "POST", body: { pin: "1234" } });
  assert.equal(employeeLogin.status, 200);
  employeeToken = employeeLogin.body.token;
  employeeId = employeeLogin.body.user.id;
  const adminLogin = await request("/api/auth/admin", null, {
    method: "POST",
    body: { email: "admin@exemplo.local", password: "admin123" }
  });
  assert.equal(adminLogin.status, 200);
  adminToken = adminLogin.body.token;
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    const exited = once(serverProcess, "exit");
    serverProcess.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test("funcionário abre OS atribuída a si e não pode precificar nem enviar ao cliente", async () => {
  const created = await request("/api/services", employeeToken, {
    method: "POST",
    body: {
      title: "Instalação de teste",
      customer: "Cliente de teste",
      date: "2026-10-24",
      time: "10:00",
      location: "Unidade de teste",
      address: "Rua de teste, 100",
      employeeIds: ["emp_outro"],
      teamId: "team_outro",
      price: 9999
    }
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.price, 0);
  assert.equal(created.body.priceStatus, "PENDING");
  assert.deepEqual(created.body.employeeIds, [employeeId]);

  assert.equal((await request(`/api/services/${created.body.id}/price`, employeeToken, {
    method: "PATCH", body: { price: 100 }
  })).status, 403);
  assert.equal((await request(`/api/services/${created.body.id}/sent-to-client`, employeeToken, {
    method: "POST", body: { channel: "whatsapp" }
  })).status, 403);

  const adminPrice = await request(`/api/services/${created.body.id}/price`, adminToken, {
    method: "PATCH", body: { price: 100 }
  });
  assert.equal(adminPrice.status, 409); // Admin passa pela autorização; a OS ainda não foi finalizada.
  const adminSend = await request(`/api/services/${created.body.id}/sent-to-client`, adminToken, {
    method: "POST", body: { channel: "whatsapp" }
  });
  assert.equal(adminSend.status, 409); // O administrador é autorizado; falta precificar a OS.
});
