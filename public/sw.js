/* Réseau d'abord pour la page (un nouveau déploiement arrive sans purge),
   cache d'abord pour les icônes. L'app reste utilisable hors ligne. */
const CACHE = "agenda-v1";
const ASSETS = ["/", "/icon.svg", "/icon-180.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return r; })
        .catch(() => caches.match("/")),
    );
    return;
  }
  e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
