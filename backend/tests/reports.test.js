const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createServiceReportPdf } = require("../server/reports");
const { MediaLoader } = require("../server/storage/media-loader");

function reportFixture() {
  return {
    clients: [{ id: "cli_1", name: "Cliente", phone: "11999999999" }],
    employees: [{ id: "emp_1", name: "Funcionário" }],
    services: [{
      id: "svc_1", code: "OS-2026-0001", title: "Serviço", clientId: "cli_1",
      date: "2026-09-02", time: "09:00", status: "done", price: 100,
      priceStatus: "PRICED", employeeIds: ["emp_1"], finishedBy: "emp_1",
      servicePhotos: {
        before: { storageKey: "before.jpg", capturedAt: "2026-09-02T12:00:00Z" },
        after: { storageKey: "after.jpg", capturedAt: "2026-09-02T13:00:00Z" }
      },
      clientSignature: { signerName: "Cliente", storageKey: "signature.png", signedAt: "2026-09-02T13:00:00Z" }
    }]
  };
}

test("relatório carrega mídia pelo ObjectStorage", async () => {
  const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const downloaded = [];
  const loader = new MediaLoader({ objectStorage: { async download(key) { downloaded.push(key); return { body: tinyPng }; } } });
  const result = await createServiceReportPdf({ db: reportFixture(), serviceId: "svc_1", options: { signature: true }, mediaLoader: loader });
  assert.equal(result.buffer.subarray(0, 4).toString(), "%PDF");
  assert.deepEqual(downloaded.sort(), ["after.jpg", "before.jpg", "signature.png"]);
});
