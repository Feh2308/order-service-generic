function bufferFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:[^;,]+;base64,(.+)$/s);
  return match ? Buffer.from(match[1], "base64") : null;
}

class MediaLoader {
  constructor({ objectStorage = null } = {}) {
    this.objectStorage = objectStorage;
  }

  async load(media) {
    if (!media) return null;
    const legacy = bufferFromDataUrl(media.imageDataUrl);
    if (legacy) return legacy;
    const key = media.objectKey || media.storageKey;
    if (!key || !this.objectStorage) return null;
    return (await this.objectStorage.download(key)).body;
  }
}

module.exports = { MediaLoader, bufferFromDataUrl };
