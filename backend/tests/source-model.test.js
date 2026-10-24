const assert = require("node:assert/strict");
const { test } = require("node:test");
const { analyzeSource } = require("../scripts/relational-migration/source-model");

function fixture() {
  const png = `data:image/png;base64,${Buffer.from("assinatura").toString("base64")}`;
  const jpg = `data:image/jpeg;base64,${Buffer.from("foto").toString("base64")}`;
  return {
    admins: [{ id: "admin_1" }],
    employees: [{ id: "emp_1" }],
    clients: [{ id: "cli_1" }],
    materials: [{ id: "mat_1" }],
    teams: [{ id: "team_1" }],
    events: [{ id: "evt_1" }],
    services: [{
      id: "svc_1",
      code: "OS-2026-0001",
      paymentStatus: "RECEIVED",
      servicePhotos: { before: { imageDataUrl: jpg }, after: null },
      clientSignature: { imageDataUrl: png }
    }]
  };
}

test("dry-run contabiliza entidades, pagamentos e mídias", () => {
  const result = analyzeSource(fixture());
  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.services, 1);
  assert.equal(result.counts.photos, 1);
  assert.equal(result.counts.signatures, 1);
  assert.equal(result.counts.paymentsReceived, 1);
  assert.equal(result.media.every((item) => item.objectKey && item.sha256), true);
});

test("dry-run bloqueia IDs e códigos duplicados", () => {
  const db = fixture();
  db.services.push({ ...db.services[0] });
  const result = analyzeSource(db);
  assert.equal(result.errors.some((item) => item.includes("ID(s) duplicado")), true);
  assert.equal(result.errors.some((item) => item.includes("código(s) duplicado")), true);
});
