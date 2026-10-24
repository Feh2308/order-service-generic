const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { ObjectStorage } = require("./object-storage");
const { ObjectStorageError } = require("./storage-errors");
const { DEFAULT_ALLOWED_MIME_TYPES, DEFAULT_MAX_BYTES, validateMedia } = require("./media-policy");
const { validateObjectKey } = require("./storage-key");

function retryable(error) {
  const status = Number(error?.$metadata?.httpStatusCode || 0);
  return status === 429 || status >= 500 || ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.code);
}

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") return Buffer.from(await body.transformToByteArray());
  const chunks = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

class S3ObjectStorage extends ObjectStorage {
  constructor(options = {}) {
    super();
    if (!options.bucket) throw new ObjectStorageError("OBJECT_STORAGE_BUCKET é obrigatório.", { code: "STORAGE_CONFIG_ERROR" });
    this.bucket = options.bucket;
    this.maxBytes = Number(options.maxBytes) || DEFAULT_MAX_BYTES;
    this.allowedMimeTypes = options.allowedMimeTypes || DEFAULT_ALLOWED_MIME_TYPES;
    this.client = options.client || new S3Client({
      region: options.region || "auto",
      endpoint: options.endpoint || undefined,
      forcePathStyle: Boolean(options.forcePathStyle),
      credentials: options.accessKeyId && options.secretAccessKey
        ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey }
        : undefined
    });
  }

  async run(operation, fn) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ObjectStorageError) throw error;
      throw new ObjectStorageError(`Falha no storage durante ${operation}.`, {
        cause: error,
        code: `STORAGE_${operation.toUpperCase()}_FAILED`,
        retryable: retryable(error)
      });
    }
  }

  async upload({ key, body, contentType, metadata = {} }) {
    const objectKey = validateObjectKey(key);
    const media = validateMedia({ body, contentType, maxBytes: this.maxBytes, allowedMimeTypes: this.allowedMimeTypes });
    await this.run("upload", () => this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      Body: media.buffer,
      ContentType: media.mimeType,
      Metadata: { ...metadata, sha256: media.sha256 }
    })));
    return { key: objectKey, ...media };
  }

  async download(key) {
    const objectKey = validateObjectKey(key);
    return this.run("download", async () => {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return {
        key: objectKey,
        body: await streamToBuffer(result.Body),
        contentType: result.ContentType || "application/octet-stream",
        metadata: result.Metadata || {}
      };
    });
  }

  async head(key) {
    const objectKey = validateObjectKey(key);
    return this.run("head", async () => {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return {
        key: objectKey,
        byteSize: Number(result.ContentLength || 0),
        contentType: result.ContentType || "application/octet-stream",
        sha256: result.Metadata?.sha256 || "",
        etag: String(result.ETag || "").replaceAll('"', "")
      };
    });
  }

  async delete(key) {
    const objectKey = validateObjectKey(key);
    await this.run("delete", () => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })));
    return { key: objectKey, deleted: true };
  }

  async createSignedUploadUrl({ key, contentType, expiresIn = 300 }) {
    const objectKey = validateObjectKey(key);
    const mimeType = String(contentType || "").toLowerCase();
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new ObjectStorageError("MIME não permitido para upload assinado.", { code: "INVALID_MIME_TYPE" });
    }
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, ContentType: mimeType });
    const url = await this.run("sign_upload", () => getSignedUrl(this.client, command, { expiresIn }));
    return { key: objectKey, url, expiresIn, contentType: mimeType, maxBytes: this.maxBytes };
  }

  async createSignedDownloadUrl(key, { expiresIn = 300, responseContentDisposition } = {}) {
    const objectKey = validateObjectKey(key);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ResponseContentDisposition: responseContentDisposition
    });
    const url = await this.run("sign_download", () => getSignedUrl(this.client, command, { expiresIn }));
    return { key: objectKey, url, expiresIn };
  }
}

module.exports = { S3ObjectStorage, streamToBuffer };
