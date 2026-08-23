/* Réseau d'abord pour la page (un nouveau déploiement arrive sans purge),
   cache d'abord pour les icônes. L'app reste utilisable hors ligne. */
const CACHE = "agenda-v8";
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
    // Chaque page vit sous sa propre clé : mettre toute navigation sous « / »
    // faisait qu'un passage par guide.html ou classes.html devenait la page
    // servie hors ligne à l'ouverture de l'app.
    const cle = new URL(req.url).pathname === "/" ? "/" : req.url;
    e.respondWith(
      fetch(req)
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(cle, copy)); return r; })
        .catch(() => caches.match(cle).then((r) => r || caches.match("/"))),
    );
    return;
  }
  // Un raté de cache ne doit jamais casser une image : on retombe
  // toujours sur le réseau, et le réseau sur le cache.
  e.respondWith(
    caches.match(req)
      .catch(() => undefined)
      .then((r) => r || fetch(req).catch(() => caches.match(req))),
  );
});

/* Un rappel qui ne ramène pas à l'agenda ne sert qu'à moitié : le clic
   ramène la fenêtre déjà ouverte au premier plan, ou en ouvre une. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/");
    }),
  );
});
