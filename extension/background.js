/**
 * Service worker — mémoire et cadence de l'extension.
 *
 *  - absorbe ce que les content scripts moissonnent (collecte passive) ;
 *  - toutes les heures, si Chrome est ouvert, relit l'accueil Léa et la boîte
 *    MIO avec TA session (collecte active) — jamais de connexion : si la
 *    session est tombée, on l'annonce (badge « ! ») et on attend que tu te
 *    reconnectes toi-même sur Omnivox, comme d'habitude ;
 *  - range tout dans chrome.storage.local, que bridge.js sert au tableau de
 *    bord au même format que data.json.
 *
 * Règles de fusion héritées du scraper local (collect.ts / persist) :
 * une échéance FUTURE qui sort du carrousel de l'accueil n'est pas annulée
 * pour autant ; les MIO se fusionnent par identifiant — mêmes graines de
 * hachage que le scraper, donc aucun doublon entre les deux collecteurs.
 */
"use strict";
importScripts("parsers.js");

const HOST = "https://cegeptr.omnivox.ca";
const URL_INTR = HOST + "/intr/";
const URL_MIO = HOST + "/WebApplication/Module.MIOE/Default.aspx?Provenance=INTR";
const MAX_MIOS = 200;

/* ---- Stockage ------------------------------------------------------------ */

const DEFAUTS = { deadlines: {}, mios: {}, bodies: {}, lastScrape: "", health: { session: "inconnue", derniereCollecte: "", derniereReussite: "", raison: "" } };

async function absorb(p) {
  if (!p || typeof p !== "object") return;
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
  await chrome.storage.local.set(st);
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

/* ---- Collecte active ------------------------------------------------------ */

const ressembleAuLogin = (finalUrl, html) =>
  /\/Login\//i.test(finalUrl) || /type=["']password["']/i.test(html);

async function collectNow(declencheur) {
  const st = await chrome.storage.local.get(DEFAUTS);
  const health = st.health;
  health.derniereCollecte = new Date().toISOString();

  try {
    const r = await fetch(URL_INTR, { credentials: "include" });
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
      const rm = await fetch(URL_MIO, { credentials: "include" });
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
}

/* ---- Cadence et messages -------------------------------------------------- */

function armeAlarme() {
  chrome.alarms.create("collecte", { periodInMinutes: 60, delayInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(armeAlarme);
chrome.runtime.onStartup.addListener(armeAlarme);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === "collecte") collectNow("horaire"); });

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target === "offscreen") return; // réponse gérée par l'offscreen
  if (msg.type === "absorb") { absorb(msg.payload); return; }
  if (msg.type === "collect-now") {
    collectNow("manuelle").then(() => sendResponse({ ok: true }));
    return true; // réponse asynchrone
  }
});
