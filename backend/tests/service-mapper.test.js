const assert = require("node:assert/strict");
const { test } = require("node:test");
const { ServiceMapper } = require("../server/repositories/service-mapper");

test("recompõe o contrato legado usando URLs assinadas", async () => {
  const mapper = new ServiceMapper({ mediaUrlResolver: async (media) => `https://storage.test/${media.object_key}` });
  const result = await mapper.toPublicService({
    service: {
      id: "svc_1", code: "OS-2026-0001", title: "Teste", client_id: "cli_1", team_id: null,
      customer_snapshot: "Cliente", scheduled_date_raw: "2026-09-02", scheduled_time_raw: "09:00",
      location: "Local", address: "Endereço", notes: "", status: "done", workflow_status: "PRECIFICADA",
      created_at: new Date(), updated_at: new Date(), sent_to_client_at: null
    },
    client: { id: "cli_1", name: "Cliente", contact: "", phone: "", email: "", address: "", notes: "", active: true },
    employees: [{ id: "emp_1", name: "Funcionário", phone: "", active: true }],
    pricing: { amount: "150.50", price_status: "PRICED", finance_notes: "" },
    payment: { payment_status: "PENDING" },
    materials: [], locations: [], updates: [],
    media: [{ kind: "photo_before", object_key: "foto.jpg", storage_object_id: "obj_1", label: "Antes" }]
  });
  assert.equal(result.code, "OS-2026-0001");
  assert.equal(result.price, 150.5);
  assert.deepEqual(result.employeeIds, ["emp_1"]);
  assert.equal(result.servicePhotos.before.imageDataUrl, "https://storage.test/foto.jpg");
});
