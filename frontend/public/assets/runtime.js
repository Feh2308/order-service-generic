(function () {
  const SERVER_URL_KEY = "serviceServerUrl";
  const REMOTE_PROTOCOLS = new Set(["file:", "capacitor:", "app:"]);

  function isHttpOrigin() {
    return window.location.protocol === "http:" || window.location.protocol === "https:";
  }

  function cleanServerUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function getBuildServerUrl() {
    const value = cleanServerUrl(window.__SERVICE_MANAGER_API_URL__);
    if (!value || value.includes("%VITE_API_URL%")) return "";
    return value;
  }

  function sameOriginBase() {
    return isHttpOrigin() ? window.location.origin : "";
  }

  function localBackendBase() {
    if (!isHttpOrigin()) return "";
    const hostname = window.location.hostname;
    const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
    if (!localHosts.has(hostname) || window.location.port === "3000") return "";
    return "http://localhost:3000";
  }

  function getSavedServerUrl() {
    return cleanServerUrl(localStorage.getItem(SERVER_URL_KEY));
  }

  function getQueryServerUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return cleanServerUrl(params.get("server") || params.get("apiBase"));
    } catch {
      return "";
    }
  }

  function getQueryDefaultServerUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      return cleanServerUrl(params.get("serverDefault"));
    } catch {
      return "";
    }
  }

  function getServerUrl() {
    const queryServerUrl = getQueryServerUrl();
    if (queryServerUrl) {
      localStorage.setItem(SERVER_URL_KEY, queryServerUrl);
      return queryServerUrl;
    }
    const savedServerUrl = getSavedServerUrl();
    if (savedServerUrl) return savedServerUrl;
    const buildServerUrl = getBuildServerUrl();
    if (buildServerUrl) return buildServerUrl;
    const queryDefaultServerUrl = getQueryDefaultServerUrl();
    if (queryDefaultServerUrl) return queryDefaultServerUrl;
    if (isPackagedApp() || isNativeApp()) return "";
    const localBackendUrl = localBackendBase();
    if (localBackendUrl) return localBackendUrl;
    return sameOriginBase();
  }

  function isPackagedApp() {
    return REMOTE_PROTOCOLS.has(window.location.protocol);
  }

  function isNativeApp() {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform);
    } catch {
      return false;
    }
  }

  function requiresServerUrl() {
    return (isPackagedApp() || isNativeApp()) && !getSavedServerUrl() && !getBuildServerUrl() && !getQueryDefaultServerUrl();
  }

  function setServerUrl(value) {
    const cleaned = cleanServerUrl(value);
    if (cleaned) localStorage.setItem(SERVER_URL_KEY, cleaned);
    else localStorage.removeItem(SERVER_URL_KEY);
    return getServerUrl();
  }

  function apiUrl(path) {
    const cleanPath = String(path || "");
    if (/^https?:\/\//i.test(cleanPath)) return cleanPath;
    const base = getServerUrl();
    return base ? `${base}${cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`}` : cleanPath;
  }

  function socketUrl() {
    return getServerUrl() || undefined;
  }

  function fillConnectionForm(form) {
    const input = form?.querySelector('[name="serverUrl"]');
    if (!input) return;
    input.value = getServerUrl();
    input.placeholder = sameOriginBase() || "https://seu-servidor.com";
  }

  function persistConnectionForm(form) {
    const input = form?.querySelector('[name="serverUrl"]');
    if (!input) return;
    setServerUrl(input.value);
  }

  window.ServiceRuntime = {
    SERVER_URL_KEY,
    apiUrl,
    cleanServerUrl,
    fillConnectionForm,
    getBuildServerUrl,
    getServerUrl,
    isNativeApp,
    isPackagedApp,
    persistConnectionForm,
    requiresServerUrl,
    setServerUrl,
    socketUrl
  };
})();
