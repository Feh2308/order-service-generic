const assert = require("node:assert/strict");
const { test } = require("node:test");
const { LegacyJsonRepository } = require("../server/repositories/legacy-json-repository");
const { PostgresRepository } = require("../server/repositories/postgres-repository");
const { assertRepository } = require("../server/repositories/repository-contract");
const { canFinishService, canStartService } = require("../server/repositories/access-policy");

function fakePool(handler = async () => ({ rows: [], rowCount: 0 })) {
  const queries = [];
  const client = {
    async query(sql, values) { queries.push({ sql, values }); return handler(sql, values); },
    release() { queries.push({ sql: "RELEASE" }); }
  };
  return { queries, connect: async () => client, query: client.query.bind(client) };
}

test("LegacyJsonRepository cobre o contrato para rollback", () => {
  const method = async () => null;
  const store = {
    db: { employees: [], clients: [], materials: [], teams: [] }, dashboard: method,
    listServicesFor: method, createClient: method, updateClient: method, createService: method,
    updateService: method, startService: method, finishService: method, priceService: method,
    receiveServicePayment: method, addServiceUpdate: method, addEvent: method
  };
  assert.doesNotThrow(() => assertRepository(new LegacyJsonRepository(store)));
});

test("criação de cliente e evento usam uma única transação", async () => {
  const pool = fakePool(async (sql) => sql.includes("RETURNING *") ? { rows: [{ id: "cli_1" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const repository = new PostgresRepository({ pool });
  await repository.createClient({ id: "cli_1", name: "Cliente" }, { id: "evt_1", type: "client.created", message: "Criado" });
  assert.equal(pool.queries.filter((item) => item.sql === "BEGIN").length, 1);
  assert.equal(pool.queries.filter((item) => item.sql === "COMMIT").length, 1);
  assert.equal(pool.queries.some((item) => item.sql.includes("INSERT INTO order_events")), true);
});

test("edição de cliente e OS usam UPDATEs pontuais", async () => {
  const pool = fakePool(async (sql) => sql.includes("RETURNING *") ? { rows: [{ id: "registro_1" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const repository = new PostgresRepository({ pool });
  await repository.updateClient("cli_1", { phone: "11999999999" });
  await repository.updateService("svc_1", { notes: "Atualizada" });
  assert.equal(pool.queries.some((item) => item.sql.startsWith("UPDATE order_clients")), true);
  assert.equal(pool.queries.some((item) => item.sql.startsWith("UPDATE order_services")), true);
  assert.equal(pool.queries.some((item) => item.sql.includes("service_manager_store")), false);
});

test("criação de OS preserva atribuições em tabela de vínculo", async () => {
  const pool = fakePool(async (sql) => sql.startsWith("INSERT INTO order_services ")
    ? { rows: [{ id: "svc_1" }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const repository = new PostgresRepository({ pool });
  await repository.createService({ id: "svc_1", code: "OS-2026-0001", createdBy: "admin_1", employeeIds: ["emp_1", "emp_2"] });
  const assignees = pool.queries.filter((item) => item.sql.startsWith("INSERT INTO order_service_assignees"));
  assert.equal(assignees.length, 2);
  assert.deepEqual(assignees.map((item) => item.values[1]), ["emp_1", "emp_2"]);
});

test("pagamento e evento são confirmados na mesma transação", async () => {
  const pool = fakePool(async (sql) => {
    if (sql.startsWith("SELECT amount")) return { rows: [{ amount: "250.00" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO order_service_payments")) return { rows: [{ id: "pay_1" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresRepository({ pool });
  await repository.receiveServicePayment("svc_1", "admin_1", { paymentMethod: "pix" }, { type: "service.payment_received", message: "Recebido" });
  assert.equal(pool.queries.some((item) => item.sql.includes("INSERT INTO order_service_payments")), true);
  assert.equal(pool.queries.some((item) => item.sql.includes("INSERT INTO order_events")), true);
  assert.equal(pool.queries.filter((item) => item.sql === "BEGIN").length, 1);
});

test("foto antes, foto depois e assinatura usam referências de storage", async () => {
  const pool = fakePool(async (sql) => sql.startsWith("INSERT INTO order_service_media")
    ? { rows: [{ id: "media_1" }], rowCount: 1 }
    : { rows: [], rowCount: 1 });
  const repository = new PostgresRepository({ pool });
  for (const kind of ["photo_before", "photo_after", "signature"]) {
    await repository.attachMedia({
      id: `media_${kind}`, serviceId: "svc_1", storageObjectId: `obj_${kind}`,
      provider: "s3", bucket: "test", objectKey: `services/svc_1/${kind}.png`,
      contentType: "image/png", byteSize: 10, sha256: "a".repeat(64), kind
    });
  }
  const inserts = pool.queries.filter((item) => item.sql.startsWith("INSERT INTO order_service_media"));
  assert.deepEqual(inserts.map((item) => item.values[3]), ["photo_before", "photo_after", "signature"]);
});

test("erro executa rollback sem commit", async () => {
  const pool = fakePool(async (sql) => {
    if (sql.startsWith("INSERT INTO order_clients")) throw new Error("falha simulada");
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresRepository({ pool });
  await assert.rejects(repository.createClient({ id: "cli_1", name: "Cliente" }), /falha simulada/);
  assert.equal(pool.queries.some((item) => item.sql === "ROLLBACK"), true);
  assert.equal(pool.queries.some((item) => item.sql === "COMMIT"), false);
});

test("permissões preservam líder para iniciar e equipe para finalizar", () => {
  const service = { status: "in_progress", employeeIds: ["emp_1", "emp_2"] };
  const team = { leaderId: "emp_1", employeeIds: ["emp_1", "emp_2"] };
  assert.equal(canStartService(service, "emp_1", team), true);
  assert.equal(canStartService(service, "emp_2", team), false);
  assert.equal(canFinishService(service, "emp_2", team), true);
  assert.equal(canFinishService(service, "emp_3", team), false);
});

test("concorrência permite somente uma transição do mesmo status", async () => {
  let transitions = 0;
  const pool = fakePool(async (sql) => {
    if (sql.startsWith("UPDATE order_services SET status")) {
      transitions += 1;
      return transitions === 1 ? { rows: [{ id: "svc_1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 1 };
  });
  const repository = new PostgresRepository({ pool });
  const first = await repository.startService("svc_1", "emp_1");
  const second = await repository.startService("svc_1", "emp_1");
  assert.equal(first.id, "svc_1");
  assert.equal(second, null);
});
