// Service Worker de SafeWalk
// Estrategia simple:
//  - Cache del shell est&#225;tico (offline fallback m&#237;nimo).
//  - Network-first para todo lo dem&#225;s; las llamadas a Firestore/Firebase Storage
//    NO se cachean (la app necesita datos en vivo).
//  - Maneja eventos 'notificationclick' para abrir la PWA al tocar la alerta.

const CACHE_NAME = "safewalk-v1";
const PRECACHE_URLS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // No interceptamos llamadas cross-origin (Firebase, OSM tiles, Storage).
  if (url.origin !== self.location.origin) return;

  // Solo GET; los dem&#225;s m&#233;todos van directo a la red.
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((res) => {
        // Refrescamos cache silenciosamente para los recursos del shell.
        if (PRECACHE_URLS.includes(url.pathname)) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/dashboard");
    })
  );
});
