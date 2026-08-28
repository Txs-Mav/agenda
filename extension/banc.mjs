/**
 * Banc d'essai du service worker — `npm run ext:banc`.
 *
 * On exécute vraiment background.js, avec un `chrome` et un `fetch` simulés :
 * le faux stockage est délibérément asynchrone, parce que c'est l'écart entre
 * le get et le set qui laisse passer les courses. Ce qu'il garde en joue :
 * la moisson qui écrase une connexion, l'échéance supprimée à la main qui
 * repart quand même vers le compte, et l'envoi qui continue après la
 * déconnexion.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (f) => readFileSync(join(ICI, f), "utf8");

const pause = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/* ---- Faux chrome.storage.local, volontairement asynchrone : c'est l'écart
       entre le get et le set qui laissait passer la course. ---- */
const boite = new Map();
const storage = {
  async get(defauts) {
    await pause(1);
    const out = {};
    for (const [k, v] of Object.entries(defauts || {})) out[k] = boite.has(k) ? boite.get(k) : v;
    return out;
  },
  async set(obj) {
    await pause(1);
    for (const [k, v] of Object.entries(obj)) boite.set(k, v);
    for (const l of ecoutesStorage) l({}, "local");
  },
};
const ecoutesStorage = [];

let onMessage = null;
const appels = [];   // ce que le SW a envoyé au réseau

globalThis.importScripts = (f) => { new Function(lire(f))(); };
globalThis.self = globalThis;
globalThis.chrome = {
  storage: { local: storage, onChanged: { addListener: (l) => ecoutesStorage.push(l) } },
  runtime: {
    onInstalled: { addListener() {} }, onStartup: { addListener() {} },
    onMessage: { addListener: (l) => { onMessage = l; } },
    sendMessage: async () => ({ deadlines: [], mios: [] }),
  },
  alarms: { create() {}, onAlarm: { addListener() {} } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  offscreen: { hasDocument: async () => true, createDocument: async () => {} },
  tabs: { create() {} },
};

globalThis.fetch = async (url, opts = {}) => {
  appels.push({ url: String(url), opts });
  const u = String(url);
  if (u.includes("grant_type=password")) {
    return { ok: true, status: 200, json: async () => ({
      access_token: "AT-1", refresh_token: "RT-1", expires_in: 3600,
      user: { id: "uid-42", email: "eleve@exemple.ca" } }) };
  }
  if (u.includes("kind=eq.suppressions")) {
    // L'étudiant a supprimé l'échéance « eSUPPR » à la main.
    return { ok: true, status: 200, json: async () => ([{ payload: { gone: { eSUPPR: 1 } } }]) };
  }
  if (u.includes("/rest/v1/agenda_snapshots")) return { ok: true, status: 200, json: async () => ([]) };
  return { ok: false, status: 500, text: async () => "", json: async () => ({}) };
};

new Function(lire("background.js"))();

let echecs = 0;
const ok = (nom, cond, detail = "") => {
  if (cond) return void console.log(`  ✓ ${nom}`);
  echecs++; console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ""}`);
};
const envoie = (msg) => new Promise((res) => {
  const r = onMessage(msg, {}, res);
  if (r !== true) res(undefined);
});

const ech = (id, date) => ({ id, date, t: "Travail " + id, course: "Bio", code: "101-115-RI", kind: "remise", src: "lea", done: false });
const futur = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

console.log("\nApprentissage de l'adresse du cégep");
{
  await envoie({ type: "hote", hote: "montmorency.omnivox.ca" });
  await pause(20);
  ok("un cégep quelconque est retenu", boite.get("hote") === "montmorency.omnivox.ca", boite.get("hote"));
  await envoie({ type: "hote", hote: "evil.example.com" });
  await pause(20);
  ok("un domaine étranger est refusé", boite.get("hote") === "montmorency.omnivox.ca", boite.get("hote"));
}

console.log("\nMoissons simultanées (le content script tourne dans tous les cadres)");
{
  for (let i = 0; i < 25; i++) envoie({ type: "absorb", payload: { deadlines: [ech("e" + i, futur)] } });
  await pause(300);
  const n = Object.keys(boite.get("deadlines") || {}).length;
  ok("les 25 moissons survivent toutes", n === 25, `${n} échéances sur 25`);
}

console.log("\nUne connexion pendant une moisson");
{
  const moisson = envoie({ type: "absorb", payload: { deadlines: [ech("eTARDIF", futur)] } });
  await pause(1);                                     // la moisson a lu, pas encore écrit
  await envoie({ type: "connexion", email: "eleve@exemple.ca", motDePasse: "x" });
  await moisson;
  await pause(50);
  ok("le compte survit à la moisson concurrente", !!boite.get("compte")?.rt, "compte effacé par absorb");
  ok("la moisson n'est pas perdue non plus", !!boite.get("deadlines")?.eTARDIF);
}

console.log("\nEnvoi vers le compte");
{
  boite.set("deadlines", { ...boite.get("deadlines"), eSUPPR: ech("eSUPPR", futur) });
  appels.length = 0;
  await envoie({ type: "collect-now" });
  await pause(200);
  const push = appels.find((a) => a.url.includes("/rest/v1/agenda_snapshots") && a.opts.method === "POST");
  ok("la collecte est poussée vers le compte", !!push);
  if (push) {
    const corps = JSON.parse(push.opts.body)[0];
    ok("écrite sous le bon compte", corps.user_id === "uid-42", corps.user_id);
    ok("sous le genre « export »", corps.kind === "export", corps.kind);
    ok("le jeton d'accès accompagne l'écriture",
      push.opts.headers.authorization === "Bearer AT-1", push.opts.headers.authorization);
    ok("l'échéance supprimée à la main ne repart pas",
      !corps.payload.deadlines.some((d) => d.id === "eSUPPR"),
      "eSUPPR est reparti vers le compte");
    ok("les autres échéances, oui", corps.payload.deadlines.length >= 25, String(corps.payload.deadlines.length));
    ok("état du nuage : ok", boite.get("health")?.nuage === "ok", boite.get("health")?.nuage);
  }
}

console.log("\nDéconnexion");
{
  await envoie({ type: "deconnexion" });
  await pause(50);
  ok("la session est oubliée", !boite.get("compte"));
  appels.length = 0;
  await envoie({ type: "absorb", payload: { deadlines: [ech("eAPRES", futur)] } });
  await pause(100);
  ok("plus rien ne part vers le compte",
    !appels.some((a) => a.url.includes("agenda_snapshots")),
    "une écriture est partie sans compte");
}

console.log(echecs ? `\n${echecs} échec(s).\n` : "\nBanc d'essai : tout est vert.\n");
process.exit(echecs ? 1 : 0);
