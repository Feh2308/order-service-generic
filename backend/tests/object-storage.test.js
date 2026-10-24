const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateMedia, sha256 } = require("../server/storage/media-policy");
const { buildMediaKey, validateObjectKey } = require("../server/storage/storage-key");

test("valida MIME, tamanho e SHA-256 da mídia", () => {
  const body = Buffer.from("imagem-de-teste");
  const result = validateMedia({ body, contentType: "image/png", maxBytes: 1024 });
  assert.equal(result.byteSize, body.length);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.sha256, sha256(body));
});

test("rejeita MIME e arquivo acima do limite", () => {
  assert.throws(() => validateMedia({ body: Buffer.from("pdf"), contentType: "application/pdf" }), /não permitido/);
  assert.throws(() => validateMedia({ body: Buffer.alloc(20), contentType: "image/jpeg", maxBytes: 10 }), /excede/);
});

test("gera chave determinística e impede travessia de diretórios", () => {
  const key = buildMediaKey({ serviceId: "svc_123", kind: "photo_before", sha256: "a".repeat(64), contentType: "image/jpeg" });
  assert.equal(key, `services/svc_123/photos/before/${"a".repeat(64)}.jpg`);
  assert.throws(() => validateObjectKey("../segredo"), /inválida/);
});
