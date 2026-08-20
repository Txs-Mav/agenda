import type { Page } from "playwright";
import { urls } from "../config.js";
import { log } from "../log.js";
import { fileStore, type Mio } from "../store.js";

/**
 * Ouvre chaque NOUVEAU MIO pour en lire le corps complet — la liste ne montre
 * qu'un aperçu tronqué, inutilisable pour extraire une date d'examen.
 *
 * Garde-fous :
 *  - cache par identifiant (mio-bodies.json) : un message n'est JAMAIS rouvert,
 *    même quand la lecture a échoué (on ne martèle pas Omnivox à chaque heure) ;
 *  - au plus LIMITE ouvertures par collecte ;
 *  - toute erreur dégrade en corps vide : l'agent retombe sur l'aperçu.
 */
const LIMITE = 8;
const MAX_LEN = 6000;

export async function fetchBodies(page: Page, mios: Mio[]): Promise<Record<string, string>> {
  const cache = fileStore.read<Record<string, string>>("mio-bodies", {});
  const nouveaux = mios.filter((m) => cache[m.id] === undefined).slice(0, LIMITE);
  if (!nouveaux.length) return cache;

  log.step(`Ouverture de ${nouveaux.length} MIO pour lire le corps complet`);
  for (const m of nouveaux) {
    try {
      cache[m.id] = await readOne(page, m);
      log.info(cache[m.id] ? `corps lu (${cache[m.id]!.length} car.) — ${m.subject.slice(0, 40)}…`
                           : `corps introuvable — ${m.subject.slice(0, 40)}…`);
    } catch (err) {
      cache[m.id] = "";
      log.warn(`lecture impossible d'un MIO : ${err instanceof Error ? err.message : err}`);
    }
  }
  fileStore.write("mio-bodies", cache);
  return cache;
}

async function readOne(page: Page, m: Mio): Promise<string> {
  // Repartir de la boîte de réception à chaque message : pas d'état à défaire.
  await page.goto(urls.mio, { waitUntil: "networkidle" }).catch(() => {});

  // L'aperçu de la liste concatène objet et début du corps : les premiers
  // caractères suffisent à retrouver la ligne, et évitent les faux négatifs
  // dus à la troncature.
  const needle = m.subject.slice(0, 25).trim();

  for (const f of [page.mainFrame(), ...page.frames()]) {
    if (!(await f.locator("#lstMIO").count().catch(() => 0))) continue;
    const cell = f.locator("#lstMIO td", { hasText: needle }).first();
    if (!(await cell.count())) return "";
    await cell.click();
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(700);
    return extractBody(page, needle);
  }
  return "";
}

/**
 * Après le clic, le message s'affiche quelque part — même cadre ou cadre
 * voisin, selon le gabarit. Plutôt que de deviner un sélecteur : on prend le
 * texte de chaque cadre qui n'est PAS la liste, et on garde le plus plausible.
 */
async function extractBody(page: Page, needle: string): Promise<string> {
  const candidats: string[] = [];
  for (const f of [page.mainFrame(), ...page.frames()]) {
    const txt = await f.evaluate(() => {
      if (document.querySelector("#lstMIO")) return "";
      return (document.body?.innerText || "").replace(/\u00a0/g, " ").trim();
    }).catch(() => "");
    if (txt && txt.length > 60) candidats.push(txt);
  }
  const clean = (s: string) =>
    s.split("\n").map((l) => l.trim()).filter(Boolean).join("\n").slice(0, MAX_LEN);
  const avec = candidats.filter((t) => t.includes(needle.slice(0, 15)));
  const best = (avec.length ? avec : candidats).sort((a, b) => b.length - a.length)[0];
  return best ? clean(best) : "";
}
