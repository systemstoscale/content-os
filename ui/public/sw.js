/* Acquisition OS service worker — makes the SPA installable + offline-capable.
 * Strategy:
 *   - navigations: network-first (always try fresh shell), fall back to cache offline.
 *   - static assets (/_next, icons, fonts, css/js): cache-first (stale-while-revalidate).
 *   - dynamic endpoints (/api, /r2, /oauth, /trigger, /webhooks): never intercepted.
 * Bump CACHE to force-refresh all clients. */
const CACHE = "aos-v1";
const SHELL = "/";
const BYPASS = ["/api", "/r2", "/oauth", "/trigger", "/webhooks", "/auth"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS.some((p) => url.pathname.startsWith(p))) return;

  // Navigations → network-first, cached shell as offline fallback.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match(SHELL))),
    );
    return;
  }

  // Static assets → cache-first, refresh in background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
