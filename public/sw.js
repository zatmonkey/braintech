// Braintech PWA service worker.
// Minimal by design: presence of a fetch handler makes the app installable.
// We cache only the static shell; authenticated pages always go to network.
const CACHE = "braintech-v2";
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

// Web Push notifications (Bri nudges on unclassified brainrot-y apps,
// future ones too). Payload from the server is JSON: {title, body, url, tag, data}.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    // Fall back to text if non-JSON
    try {
      payload = { title: "Braintech", body: event.data ? event.data.text() : "" };
    } catch (_) {
      payload = { title: "Braintech", body: "" };
    }
  }
  const title = payload.title || "Braintech";
  const options = {
    body: payload.body || "",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: payload.tag, // collapses repeated alerts on same app
    data: { url: payload.url || "/app", ...(payload.data || {}) },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // If an /app tab is already open, focus it.
      for (const c of list) {
        if ("focus" in c && c.url.includes("/app")) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
