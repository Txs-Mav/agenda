/* Réseau d'abord pour la page et les données (un nouveau déploiement arrive
   sans purge), cache d'abord pour les icônes. L'app reste utilisable hors
   ligne — dernier horaire et dernières données compris. */
importScripts("/config.js");

/* /config.js est précaché et servi cache d'abord : si la config d'instance
   change, ce bump de CACHE doit suivre, sinon l'ancienne copie reste servie. */
const CACHE = "agenda-v10";
const ASSETS = ["/", "/config.js", "/icon.svg", "/icon-180.png", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

/* La clé VAPID publique vit dans /config.js — la même que pour la page. Elle
   est publique par conception ; la privée ne quitte jamais le .env. */
const PUSH_PUB = AGENDA_CONFIG.vapidClePublique;

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
  const url = new URL(req.url);
  /* Les données de même origine (horaire.json, data.json) : réseau d'abord,
     copie gardée — dans le métro, l'horaire d'hier vaut mieux que rien. */
  if (url.origin === location.origin && url.pathname.endsWith(".json")) {
    e.respondWith(
      fetch(req)
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return r; })
        .catch(() => caches.match(req)),
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

/* Un push arrive app fermée : c'est tout son intérêt. La charge est du JSON
   { title, body, url, tag } ; un texte nu fait quand même une notification. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data?.json() || {}; } catch { d = { body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Agenda", {
    body: d.body || "", tag: d.tag || "agenda-push", lang: "fr-CA",
    icon: "icon-192.png", badge: "icon-192.png",
    data: { url: d.url || "/" },
  }));
});

/* Le navigateur peut remplacer un abonnement de son propre chef : on se
   réabonne sans déranger personne. La nouvelle adresse sera poussée vers le
   compte à la prochaine ouverture de l'app (pushSync au démarrage). */
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(PUSH_PUB) })
      .catch(() => {}),
  );
});

function b64ToU8(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/* Un rappel qui ne ramène pas à l'agenda ne sert qu'à moitié : le clic
   ramène la fenêtre déjà ouverte au premier plan, ou en ouvre une — à la
   page que la notification désigne. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const cible = e.notification.data?.url || "/";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow(cible);
    }),
  );
});
