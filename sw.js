/* Pausa V2: PWA publica sin guardar informacion privada en CacheStorage.
   Nunca interceptar API, paginas del personal ni administracion. */
const VERSION = "pausa-publica-v6";
const SHELL = [
  "./puntos.html",
  "./assets/css/base.css",
  "./assets/js/config.js",
  "./assets/js/main.js",
  "./assets/js/puntos.js?v=6",
  "./assets/js/qrcode.js",
  "./assets/icons/icon-192.png",
  "./manifest.webmanifest"
];

const PUBLIC_SCRIPTS = new Set([
  "assets/js/config.js", "assets/js/main.js",
  "assets/js/puntos.js", "assets/js/qrcode.js"
]);

function isPublicCacheable(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) return false;
  const path = url.pathname.slice(scopePath.length);

  if (path === "" || path === "index.html" || path === "index" ||
      path === "puntos.html" || path === "puntos" ||
      path === "qr.html" || path === "qr" ||
      path === "manifest.webmanifest") return true;

  if (PUBLIC_SCRIPTS.has(path)) return true;
  return /^(assets\/(?:css|fonts|img|icons)\/)/.test(path);
}

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith("pausa-") && key !== VERSION)
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", function(event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Lista explicita: cualquier recurso no publico pasa directo a la red.
  // Incluye /api/*, /personal, /administracion y otras futuras rutas privadas.
  if (!isPublicCacheable(url)) return;

  event.respondWith(
    fetch(req, { cache: "no-cache" }).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        event.waitUntil(
          caches.open(VERSION)
            .then(cache => cache.put(req, copy))
            .catch(() => {})
        );
      }
      return res;
    }).catch(async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === "navigate") {
        return (await caches.match("./puntos.html")) || Response.error();
      }
      return Response.error();
    })
  );
});
