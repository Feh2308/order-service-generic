class ObjectStorageError extends Error {
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "ObjectStorageError";
    this.code = options.code || "OBJECT_STORAGE_ERROR";
    this.retryable = Boolean(options.retryable);
  }
}

class ObjectValidationError extends ObjectStorageError {
  constructor(message, code = "OBJECT_VALIDATION_ERROR") {
    super(message, { code, retryable: false });
    this.name = "ObjectValidationError";
  }
}

module.exports = { ObjectStorageError, ObjectValidationError };
