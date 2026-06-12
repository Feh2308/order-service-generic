const CACHE_NAME = "eg-services-v9";
const ASSETS = [
  "/",
  "/index.html",
  "/admin/",
  "/funcionario/",
  "/assets/styles.css",
  "/assets/runtime.js",
  "/assets/icons.js",
  "/assets/admin.js",
  "/assets/employee.js",
  "/assets/logo.svg",
  "/vendor/lucide/lucide.min.js",
  "/vendor/socket.io/socket.io.min.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.url.includes("/api/") || request.url.includes("/socket.io/")) {
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request))
  );
});
