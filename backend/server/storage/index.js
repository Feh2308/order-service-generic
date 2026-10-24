const { S3ObjectStorage } = require("./s3-object-storage");

function objectStorageConfigFromEnv(env = process.env) {
  return {
    enabled: String(env.OBJECT_STORAGE_ENABLED || "false").toLowerCase() === "true",
    provider: String(env.OBJECT_STORAGE_PROVIDER || "s3").toLowerCase(),
    bucket: env.OBJECT_STORAGE_BUCKET || "",
    endpoint: env.OBJECT_STORAGE_ENDPOINT || "",
    region: env.OBJECT_STORAGE_REGION || "auto",
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY || "",
    maxBytes: Number(env.OBJECT_STORAGE_MAX_BYTES || 3145728),
    forcePathStyle: String(env.OBJECT_STORAGE_FORCE_PATH_STYLE || "false").toLowerCase() === "true"
  };
}

function createObjectStorage(options = objectStorageConfigFromEnv()) {
  if (!options.enabled) return null;
  if (options.provider !== "s3") throw new Error(`Object Storage não suportado: ${options.provider}.`);
  return new S3ObjectStorage(options);
}

module.exports = { createObjectStorage, objectStorageConfigFromEnv };
