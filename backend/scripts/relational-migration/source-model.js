const crypto = require("crypto");
const { buildMediaKey } = require("../../server/storage/storage-key");

const array = (value) => Array.isArray(value) ? value : [];
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const stableId = (prefix, value) => `${prefix}_${sha256(Buffer.from(String(value))).slice(0, 32)}`;

function parseDataUrl(value) {
  const match = String(value || "").match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) return null;
  const body = Buffer.from(match[2], "base64");
  return { body, contentType: match[1].toLowerCase(), byteSize: body.length, sha256: sha256(body) };
}

function nullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sqlDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : null;
}

function sqlTime(value) {
  return /^\d{2}:\d{2}(?::\d{2})?$/.test(String(value || "")) ? value : null;
}

function collectMedia(db) {
  const media = [];
  for (const service of array(db.services)) {
    const candidates = [
      { kind: "photo_before", value: service?.servicePhotos?.before?.imageDataUrl, metadata: service?.servicePhotos?.before },
      { kind: "photo_after", value: service?.servicePhotos?.after?.imageDataUrl, metadata: service?.servicePhotos?.after },
      { kind: "signature", value: service?.clientSignature?.imageDataUrl, metadata: service?.clientSignature }
    ];
    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const decoded = parseDataUrl(candidate.value);
      media.push({
        serviceId: service.id,
        serviceCode: service.code,
        kind: candidate.kind,
        valid: Boolean(decoded),
        metadata: candidate.metadata,
        ...(decoded || {})
      });
    }
  }
  return media.map((item) => item.valid ? {
    ...item,
    storageObjectId: stableId("obj", `${item.serviceId}:${item.kind}`),
    mediaId: stableId("media", `${item.serviceId}:${item.kind}`),
    objectKey: buildMediaKey({ serviceId: item.serviceId, kind: item.kind, sha256: item.sha256, contentType: item.contentType })
  } : item);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicate = new Set();
  values.filter(Boolean).forEach((value) => seen.has(value) ? duplicate.add(value) : seen.add(value));
  return [...duplicate];
}

function analyzeSource(db) {
  const entities = {
    admins: array(db.admins),
    employees: array(db.employees),
    clients: array(db.clients),
    materials: array(db.materials),
    teams: array(db.teams),
    services: array(db.services),
    events: array(db.events)
  };
  const media = collectMedia(db);
  const ids = Object.fromEntries(Object.entries(entities).map(([name, values]) => [name, values.map((item) => item.id)]));
  const serviceCodes = entities.services.map((service) => service.code);
  const errors = [];

  for (const [name, values] of Object.entries(ids)) {
    const missing = values.filter((value) => !value).length;
    const duplicates = duplicateValues(values);
    if (missing) errors.push(`${name}: ${missing} ID(s) ausente(s).`);
    if (duplicates.length) errors.push(`${name}: ${duplicates.length} ID(s) duplicado(s).`);
  }
  const duplicateCodes = duplicateValues(serviceCodes);
  if (duplicateCodes.length) errors.push(`services: ${duplicateCodes.length} código(s) duplicado(s).`);
  if (media.some((item) => !item.valid)) errors.push(`${media.filter((item) => !item.valid).length} mídia(s) inválida(s).`);

  return {
    entities,
    media,
    ids,
    serviceCodes,
    receivedPaymentServiceIds: entities.services.filter((item) => item.paymentStatus === "RECEIVED").map((item) => item.id),
    sourceSha256: sha256(Buffer.from(JSON.stringify(db), "utf8")),
    counts: {
      admins: entities.admins.length,
      employees: entities.employees.length,
      clients: entities.clients.length,
      materials: entities.materials.length,
      teams: entities.teams.length,
      services: entities.services.length,
      events: entities.events.length,
      photos: media.filter((item) => item.kind.startsWith("photo_")).length,
      signatures: media.filter((item) => item.kind === "signature").length,
      paymentsReceived: entities.services.filter((item) => item.paymentStatus === "RECEIVED").length,
      mediaBytes: media.reduce((total, item) => total + (item.byteSize || 0), 0)
    },
    errors
  };
}

module.exports = { analyzeSource, array, collectMedia, nullableDate, parseDataUrl, sha256, sqlDate, sqlTime, stableId };
