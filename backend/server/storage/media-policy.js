const crypto = require("crypto");
const { ObjectValidationError } = require("./storage-errors");

const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
const DEFAULT_ALLOWED_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeMimeType(value) {
  return String(value || "").trim().toLowerCase().split(";")[0];
}

function validateMedia({ body, contentType, maxBytes = DEFAULT_MAX_BYTES, allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES }) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || "");
  const mimeType = normalizeMimeType(contentType);

  if (!buffer.length) throw new ObjectValidationError("O arquivo está vazio.", "EMPTY_OBJECT");
  if (!allowedMimeTypes.includes(mimeType)) {
    throw new ObjectValidationError(`Tipo de arquivo não permitido: ${mimeType || "desconhecido"}.`, "INVALID_MIME_TYPE");
  }
  if (buffer.length > maxBytes) {
    throw new ObjectValidationError(`O arquivo excede o limite de ${maxBytes} bytes.`, "OBJECT_TOO_LARGE");
  }

  return { buffer, mimeType, byteSize: buffer.length, sha256: sha256(buffer) };
}

module.exports = {
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_BYTES,
  normalizeMimeType,
  sha256,
  validateMedia
};
