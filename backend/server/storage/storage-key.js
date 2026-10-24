const path = require("path");
const { ObjectValidationError } = require("./storage-errors");

const KIND_DIRECTORIES = Object.freeze({
  photo_before: "photos/before",
  photo_after: "photos/after",
  signature: "signatures"
});

const MIME_EXTENSIONS = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
});

function safeSegment(value, label) {
  const segment = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!segment) throw new ObjectValidationError(`${label} inválido para a chave do arquivo.`, "INVALID_OBJECT_KEY");
  return segment;
}

function buildMediaKey({ serviceId, kind, sha256, contentType }) {
  const directory = KIND_DIRECTORIES[kind];
  const extension = MIME_EXTENSIONS[contentType];
  if (!directory || !extension) {
    throw new ObjectValidationError("Tipo de mídia ou MIME inválido para a chave.", "INVALID_OBJECT_KEY");
  }

  const service = safeSegment(serviceId, "ID do serviço");
  const hash = safeSegment(sha256, "SHA-256");
  return path.posix.join("services", service, directory, `${hash}.${extension}`);
}

function validateObjectKey(key) {
  const normalized = String(key || "").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || normalized.includes("\\")) {
    throw new ObjectValidationError("Chave de arquivo inválida.", "INVALID_OBJECT_KEY");
  }
  return normalized;
}

module.exports = { buildMediaKey, validateObjectKey };
