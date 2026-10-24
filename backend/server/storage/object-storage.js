class ObjectStorage {
  async upload(_input) {
    throw new Error("ObjectStorage.upload não implementado.");
  }

  async download(_key) {
    throw new Error("ObjectStorage.download não implementado.");
  }

  async head(_key) {
    throw new Error("ObjectStorage.head não implementado.");
  }

  async delete(_key) {
    throw new Error("ObjectStorage.delete não implementado.");
  }

  async createSignedUploadUrl(_input) {
    throw new Error("ObjectStorage.createSignedUploadUrl não implementado.");
  }

  async createSignedDownloadUrl(_key, _options = {}) {
    throw new Error("ObjectStorage.createSignedDownloadUrl não implementado.");
  }
}

module.exports = { ObjectStorage };
