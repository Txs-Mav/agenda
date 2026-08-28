/**
 * Service worker — mémoire, cadence et pont nuagique de l'extension.
 *
 *  - absorbe ce que les content scripts moissonnent (collecte passive) ;
 *  - toutes les heures, si Chrome est ouvert, relit l'accueil Léa et la boîte
 *    MIO avec TA session (collecte active) — jamais de connexion : si la
 *    session est tombée, on l'annonce (badge « ! ») et on attend que tu te
 *    reconnectes toi-même sur Omnivox, comme d'habitude ;
 *  - range tout dans chrome.storage.local, que bridge.js sert au tableau de
 *    bord au même format que data.json ;
 *  - pousse la collecte vers TON compte d'agenda (Supabase), pour qu'elle
 *    arrive sur le téléphone sans que le tableau de bord soit ouvert ici.
 *
 * Règles de fusion héritées du scraper local (collect.ts / persist) :
 * une échéance FUTURE qui sort du carrousel de l'accueil n'est pas annulée
 * pour autant ; les MIO se fusionnent par identifiant — mêmes graines de
 * hachage que le scraper, donc aucun doublon entre les deux collecteurs.
 */
"use strict";
importScripts("parsers.js");

const MAX_MIOS = 200;

/* Le compte d'AGENDA — pas Omnivox. Mêmes clés publiques que le tableau de
   bord, et mêmes règles RLS : chacun n'écrit que ses propres lignes. */
const SB_URL = "https://olkbhrbyubejetqygdcy.supabase.co";
const SB_KEY = "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X";

/* ---- Stockage ------------------------------------------------------------ */

const DEFAUTS = {
  deadlines: {}, mios: {}, bodies: {}, lastScrape: "",
  /* L'adresse d'Omnivox n'est plus codée en dur : chaque cégep a la sienne
     (cegeptr, clg, montmorency…). On l'apprend du premier passage sur le
     portail plutôt que de la demander. */
  hote: "",
  /* { rt, at, exp, uid, email } — la session du compte d'agenda. L'extension
     ouvre la SIENNE : un jeton de rafraîchissement partagé avec la page se
     ferait révoquer à la première rotation, et déconnecterait les deux. */
  compte: null,
  /* Le courriel vu sur le tableau de bord, pour le proposer au lieu de le
     faire retaper. Un indice, pas une session. */
  indiceEmail: "",
  aPousser: false,
  health: {
    session: "inconnue", derniereCollecte: "", derniereReussite: "", raison: "",
    nuage: "hors", nuageQuand: "", nuageRaison: "",
  },
};

const urlIntr = (h) => `https://${h}/intr/`;
const urlMio = (h) => `https://${h}/WebApplication/Module.MIOE/Default.aspx?Provenance=INTR`;

/* Une seule écriture à la fois. Le content script tourne dans TOUS les cadres
   d'Omnivox : sans cette file, deux cadres qui moissonnent ensemble lisent le
   même état, le modifient chacun de leur côté, et le second écrase le premier
   — la moitié de la collecte disparaissait. */
let chaine = Promise.resolve();
function enFile(job) {
  const suite = chaine.then(job, job);
  chaine = suite.catch(() => {});
  return suite;
}

async function absorb(p) {
  if (!p || typeof p !== "object") return;
  return enFile(async () => {
    const st = await chrome.storage.local.get(DEFAUTS);
    let touche = false;
    const today = new Date().toISOString().slice(0, 10);

    const fraiches = new Set((p.deadlines || []).map((d) => d.id));
    for (const d of p.deadlines || []) {
      if (d && d.id && d.date) { st.deadlines[d.id] = d; touche = true; }
    }
    // Fenêtre glissante : le passé absent du frais s'en va, le futur reste.
    for (const [id, d] of Object.entries(st.deadlines)) {
      if (!fraiches.has(id) && d.date < today) { delete st.deadlines[id]; touche = true; }
    }

    for (const m of p.mios || []) {
      if (!m || !m.id) continue;
      st.mios[m.id] = { ...(st.mios[m.id] || {}), ...m };
      touche = true;
    }

    // Corps d'un message ouvert : rattaché au MIO par le début de son objet,
    // comme lire.ts. L'URL profonde devient cliquable dans le tableau de bord.
    for (const v of p.vues || []) {
      const mio = Object.values(st.mios).find((m) => m.subject && v.text.includes(m.subject.slice(0, 25).trim()));
      if (!mio) continue;
      st.bodies[mio.id] = { url: v.url, body: v.text, links: v.links || [] };
      st.mios[mio.id] = { ...mio, url: v.url };
      touche = true;
    }

    if (!touche) return;

    // Bornes : les 200 MIO les plus récents, et aucun corps orphelin.
    const garde = Object.values(st.mios)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, MAX_MIOS);
    st.mios = Object.fromEntries(garde.map((m) => [m.id, m]));
    for (const id of Object.keys(st.bodies)) if (!st.mios[id]) delete st.bodies[id];

    st.lastScrape = new Date().toISOString();
    /* On ne réécrit QUE ce que la moisson possède. Réécrire `st` en entier
       reposerait aussi `compte`, `health` et `hote` tels qu'ils étaient au
       début du travail : une connexion ou une collecte partie entre-temps
       serait effacée par une moisson plus vieille qu'elle. */
    await chrome.storage.local.set({
      deadlines: st.deadlines, mios: st.mios, bodies: st.bodies,
      lastScrape: st.lastScrape, aPousser: true,
    });
    pousseeDifferee();
  });
}

/** L'adresse du portail, apprise du cadre qui vient d'être moissonné. */
async function retenirHote(hote) {
  if (!/^[a-z0-9.-]+\.omnivox\.ca$/i.test(hote || "")) return;
  const { hote: connu } = await chrome.storage.local.get({ hote: "" });
  if (connu !== hote) await chrome.storage.local.set({ hote });
}

/* ---- Analyse hors DOM (offscreen) ---------------------------------------- */

let creation = null;
async function ensureOffscreen() {
  if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) return;
  creation ??= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Analyser le HTML des pages Omnivox relues en arrière-plan",
    })
    .catch((e) => { if (!/single offscreen/i.test(String(e))) throw e; })
    .finally(() => { creation = null; });
  await creation;
}

async function parseAilleurs(kind, html) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: "offscreen", kind, html });
  return r && !r.erreur ? r : { deadlines: [], mios: [] };
}

/* ---- Le compte d'agenda (Supabase) --------------------------------------- */

/** Connexion explicite depuis le popup. Le mot de passe n'est jamais rangé —
    seul le jeton de rafraîchissement l'est, comme dans n'importe quelle app. */
async function sbConnexion(email, motDePasse) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SB_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: motDePasse }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) {
    const brut = d.msg || d.error_description || d.message || `erreur ${r.status}`;
    return { erreur: /invalid login credentials/i.test(brut)
      ? "Courriel ou mot de passe incorrect."
      : /email not confirmed/i.test(brut) ? "Confirme d'abord le code reçu par courriel."
      : brut };
  }
  await chrome.storage.local.set({ compte: {
    rt: d.refresh_token, at: d.access_token,
    exp: Date.now() + (d.expires_in || 3600) * 1000,
    uid: d.user?.id || "", email: d.user?.email || email,
  } });
  pousserNuage();
  return { ok: true, email: d.user?.email || email };
}

async function sbDeconnexion() {
  const { compte } = await chrome.storage.local.get({ compte: null });
  await chrome.storage.local.set({ compte: null });
  const h = (await chrome.storage.local.get(DEFAUTS)).health;
  h.nuage = "hors"; h.nuageRaison = "";
  await chrome.storage.local.set({ health: h });
  if (!compte?.at) return;
  // Le dire au serveur : sinon le jeton reste valable des mois.
  try {
    await fetch(`${SB_URL}/auth/v1/logout`, { method: "POST",
      headers: { apikey: SB_KEY, authorization: `Bearer ${compte.at}` } });
  } catch { /* hors ligne : la session locale est partie, c'est l'essentiel */ }
}

/* Un seul rafraîchissement à la fois : Supabase fait tourner le jeton à chaque
   échange, et deux appels partis ensemble avec le même feraient révoquer la
   session entière. */
let renouv = null;
async function sbJeton() {
  const { compte } = await chrome.storage.local.get({ compte: null });
  if (!compte || !compte.rt) return null;
  if (compte.at && compte.exp && Date.now() < compte.exp - 60_000) return compte.at;
  if (!renouv) {
    renouv = (async () => {
      const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: SB_KEY, "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: compte.rt }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.access_token) {
        /* Refus net du serveur : le jeton est mort, on redemandera le mot de
           passe. Panne ou hors ligne : on ne touche à rien, ça reviendra. */
        if (r.status >= 400 && r.status < 500) await chrome.storage.local.set({ compte: null });
        return null;
      }
      await chrome.storage.local.set({ compte: {
        rt: d.refresh_token || compte.rt, at: d.access_token,
        exp: Date.now() + (d.expires_in || 3600) * 1000,
        uid: d.user?.id || compte.uid, email: d.user?.email || compte.email,
      } });
      return d.access_token;
    })().catch(() => null).finally(() => { renouv = null; });
  }
  return renouv;
}

/** Ce que tu as supprimé à la main dans l'agenda. À relire AVANT d'écrire :
    sinon la collecte suivante te remet l'échéance que tu viens de retirer —
    Omnivox, lui, continue de l'afficher. */
async function sbSuppressions(at) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/agenda_snapshots?kind=eq.suppressions&select=payload`, {
      headers: { apikey: SB_KEY, authorization: `Bearer ${at}` },
    });
    if (!r.ok) return new Set();
    const rows = await r.json();
    return new Set(Object.keys(rows[0]?.payload?.gone ?? {}));
  } catch { return new Set(); }
}

/** La collecte vers le compte, au même contrat que data.json et que le
    scraper local : une seule ligne « export », remplacée à chaque passage. */
async function pousserNuage() {
  const st = await chrome.storage.local.get(DEFAUTS);
  const health = st.health;
  const at = await sbJeton();
  if (!at) {
    health.nuage = "hors"; health.nuageRaison = "";
    await chrome.storage.local.set({ health });
    return;
  }
  const { compte } = await chrome.storage.local.get({ compte: null });
  if (!compte?.uid) return;

  const gone = await sbSuppressions(at);
  const deadlines = Object.values(st.deadlines).filter((d) => !gone.has(d.id));
  const mios = Object.values(st.mios)
    .filter((m) => !gone.has(m.id))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .map((m) => (st.bodies[m.id]?.url && !m.url ? { ...m, url: st.bodies[m.id].url } : m));
  if (!deadlines.length && !mios.length) {
    await chrome.storage.local.set({ aPousser: false });
    return;   // rien de collecté encore : il n'y a pas d'échec là-dedans
  }

  try {
    const r = await fetch(`${SB_URL}/rest/v1/agenda_snapshots`, {
      method: "POST",
      headers: {
        apikey: SB_KEY, authorization: `Bearer ${at}`,
        "content-type": "application/json", prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify([{ user_id: compte.uid, kind: "export",
        payload: { lastScrape: st.lastScrape || null, mios, deadlines } }]),
    });
    if (r.ok) {
      health.nuage = "ok"; health.nuageRaison = "";
      health.nuageQuand = new Date().toISOString();
      /* Une moisson a pu tomber pendant l'envoi : le drapeau ne se baisse que
         si l'état poussé est encore le dernier, sinon le frais attendrait
         l'alarme de trente minutes pour rien. */
      const apres = await chrome.storage.local.get({ lastScrape: "" });
      if (apres.lastScrape === st.lastScrape) await chrome.storage.local.set({ aPousser: false });
    } else {
      health.nuage = "erreur";
      health.nuageRaison = `Le compte a refusé l'écriture (${r.status}).`;
    }
  } catch {
    health.nuage = "erreur";
    health.nuageRaison = "Compte injoignable — la collecte repartira au prochain passage.";
  }
  await chrome.storage.local.set({ health });
}

/* La moisson passive se déclenche à chaque mutation de page : on laisse
   retomber la poussière plutôt que d'écrire au nuage vingt fois par minute. */
let minuteur = null;
function pousseeDifferee() {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => { pousserNuage(); }, 15_000);
}

/* ---- Collecte active ------------------------------------------------------ */

const ressembleAuLogin = (finalUrl, html) =>
  /\/Login\//i.test(finalUrl) || /type=["']password["']/i.test(html);

async function collectNow(declencheur) {
  const st = await chrome.storage.local.get(DEFAUTS);
  const health = st.health;
  health.derniereCollecte = new Date().toISOString();

  if (!st.hote) {
    health.session = "inconnue";
    health.raison = "Ouvre Omnivox une fois : l'extension apprendra l'adresse de ton cégep toute seule.";
    await chrome.storage.local.set({ health });
    return;
  }

  try {
    const r = await fetch(urlIntr(st.hote), { credentials: "include" });
    const html = await r.text();

    if (ressembleAuLogin(r.url, html)) {
      // Session tombée. On ne se connecte JAMAIS à ta place : un login
      // automatisé raté arme le captcha d'Omnivox. Reconnecte-toi
      // normalement ; la collecte repart toute seule ensuite.
      health.session = "expiree";
      health.raison = "Omnivox demande une connexion — ouvre Omnivox et connecte-toi, la collecte reprendra.";
      await chrome.storage.local.set({ health });
      await chrome.action.setBadgeBackgroundColor({ color: "#b3402a" });
      await chrome.action.setBadgeText({ text: "!" });
      return;
    }

    const accueil = await parseAilleurs("accueil", html);
    await absorb({ deadlines: accueil.deadlines || [] });

    // La liste MIO vit dans un cadre du module MIOE : on lit la page du
    // module, on suit le src du cadre MioListe, on parse #lstMIO.
    try {
      const rm = await fetch(urlMio(st.hote), { credentials: "include" });
      const hm = await rm.text();
      if (!ressembleAuLogin(rm.url, hm)) {
        const direct = await parseAilleurs("mio", hm);
        let mios = direct.mios || [];
        if (!mios.length) {
          const m = /<i?frame[^>]+src=["']([^"']*MioListe[^"']*)["']/i.exec(hm);
          if (m) {
            const rl = await fetch(new URL(m[1].replace(/&amp;/g, "&"), rm.url).href, { credentials: "include" });
            const liste = await parseAilleurs("mio", await rl.text());
            mios = liste.mios || [];
          }
        }
        if (mios.length) await absorb({ mios });
      }
    } catch { /* meilleur effort : la collecte passive couvre les MIO */ }

    health.session = "ok";
    health.raison = "";
    health.derniereReussite = new Date().toISOString();
    await chrome.action.setBadgeText({ text: "" });
  } catch (e) {
    health.session = health.session === "ok" ? "inconnue" : health.session;
    health.raison = `Collecte ${declencheur} impossible : ${e && e.message ? e.message : e}`;
  }
  await chrome.storage.local.set({ health });
  await pousserNuage();
}

/* ---- Cadence et messages -------------------------------------------------- */

function armeAlarme() {
  chrome.alarms.create("collecte", { periodInMinutes: 60, delayInMinutes: 1 });
  // Un filet : si le service worker s'est fait tuer avant sa poussée différée,
  // le frais en attente part quand même.
  chrome.alarms.create("nuage", { periodInMinutes: 30, delayInMinutes: 5 });
}
chrome.runtime.onInstalled.addListener(armeAlarme);
chrome.runtime.onStartup.addListener(armeAlarme);
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === "collecte") return void collectNow("horaire");
  if (a.name === "nuage") {
    const { aPousser } = await chrome.storage.local.get({ aPousser: false });
    if (aPousser) pousserNuage();
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return; // réponse gérée par l'offscreen
  if (msg.type === "absorb") { absorb(msg.payload); return; }
  if (msg.type === "hote") { retenirHote(msg.hote); return; }
  if (msg.type === "indice") {
    if (msg.email) chrome.storage.local.set({ indiceEmail: String(msg.email).slice(0, 160) });
    return;
  }
  if (msg.type === "collect-now") {
    collectNow("manuelle").then(() => sendResponse({ ok: true }));
    return true; // réponse asynchrone
  }
  if (msg.type === "connexion") {
    sbConnexion(msg.email, msg.motDePasse)
      .then(sendResponse)
      .catch(() => sendResponse({ erreur: "Serveur injoignable — réessaie dans un instant." }));
    return true;
  }
  if (msg.type === "deconnexion") {
    sbDeconnexion().then(() => sendResponse({ ok: true }));
    return true;
  }
});
