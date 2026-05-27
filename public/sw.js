// Braintech PWA service worker.
// Minimal by design: presence of a fetch handler makes the app installable.
// We cache only the static shell; authenticated pages always go to network.
const CACHE = "braintech-v1";
const SHELL = ["/icon.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Never cache API or authenticated navigations — always live.
  if (req.method !== "GET" || new URL(req.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())),
  );
});
