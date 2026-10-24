const APP_VERSION = "20260718-cache-safe-api-url";
const CACHE_NAME = `service-manager-${APP_VERSION}`;
const versioned = (path) => `${path}?v=${APP_VERSION}`;
const ASSETS = [
  "/",
  "/index.html",
  "/admin/",
  "/funcionario/",
  versioned("/assets/Admin.css"),
  versioned("/assets/Funcionario.css"),
  versioned("/assets/runtime.js"),
  versioned("/assets/icons.js"),
  versioned("/assets/admin.js"),
  versioned("/assets/employee.js"),
  "/assets/logo.svg",
  "/vendor/lucide/lucide.min.js",
  "/vendor/socket.io/socket.io.min.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS.map((asset) =>
          cache.add(asset).catch((error) => {
            console.warn("Falha ao salvar asset no cache", asset, error);
          })
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
  return;
}

  if (request.url.includes("/socket.io/")) return;

  if (request.method === "GET" && request.url.includes("/api/")) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone());
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || new Response(JSON.stringify([]));
        })
    );
    return;
  }

  event.respondWith(
    fetch(new Request(request, { cache: "no-store" }))
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
