import type { Page } from "playwright";
import { urls } from "../config.js";
import { log } from "../log.js";
import type { Deadline } from "../store.js";

/**
 * La page d'accueil d'Omnivox (/intr/) porte une section « Évènements » qui
 * liste déjà les travaux à remettre et les évaluations, avec date, type,
 * cours, sigle et pondération. C'est une meilleure cible que Léa : une seule
 * page, pas de navigation par module.
 *
 * On ne devine aucun sélecteur : on repère les cartes par leur texte
 * (« TRAVAIL À REMETTRE » / « ÉVALUATION ») puis on lit leurs lignes.
 * Un changement de gabarit CSS ne casse rien ; un changement d'intitulé oui,
 * et c'est voulu — mieux vaut zéro échéance qu'une échéance inventée.
 */
const MOIS = ["janvier","février","mars","avril","mai","juin",
              "juillet","août","septembre","octobre","novembre","décembre"];

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type RawEvent = {
  lines: string[];
  text: string;
};

export async function readEventCards(page: Page): Promise<RawEvent[]> {
  await page.goto(urls.intranet, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.evaluate(() => {
    const rx = /travail\s+à\s+remettre|évaluation/i;
    const all = [...document.querySelectorAll<HTMLElement>("div,li,article,section,td")];
    const hits = all.filter((el) => {
      const t = el.innerText || "";
      return rx.test(t) && t.length > 20 && t.length < 500;
    });
    // Ne garder que les plus internes : une carte, pas ses conteneurs.
    const inner = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
    return inner.map((el) => {
      const text = (el.innerText || "").replace(/ /g, " ");
      return { text, lines: text.split("\n").map((l) => l.trim()).filter(Boolean) };
    });
  });
}

/** Convertit une carte en échéance, ou null si elle n'est pas exploitable. */
export function parseEvent(ev: RawEvent, today = new Date()): Deadline | null {
  const text = ev.text;

  const dm = /\b(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\b/i
    .exec(strip(text).replace(/fevrier/, "février").replace(/aout/, "août").replace(/decembre/, "décembre"))
    ?? /\b(\d{1,2})\s+([a-zà-ÿ]+)\b/i.exec(text);
  if (!dm) return null;
  const day = Number(dm[1]);
  const mIdx = MOIS.findIndex((m) => strip(m).startsWith(strip(dm[2] ?? "").slice(0, 4)));
  if (mIdx < 0 || !day) return null;

  // Les cartes n'affichent pas l'année : on prend l'année courante, et si la
  // date tombe plus de trois mois dans le passé, c'est la session suivante.
  let year = today.getFullYear();
  let when = new Date(year, mIdx, day);
  if ((today.getTime() - when.getTime()) / 864e5 > 90) { year += 1; when = new Date(year, mIdx, day); }
  const date = `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const tm = /\b(\d{1,2})\s*[h:]\s*(\d{2})\b/.exec(text);
  const time = tm ? `${String(tm[1]).padStart(2, "0")}:${tm[2]}` : "";

  const isExam = /évaluation/i.test(text);
  const code = /(\d{3}-\w{3}-\w{2})/.exec(text)?.[1] ?? "";
  const weight = /\((\d+(?:[.,]\d+)?)\s*%\)/.exec(text)?.[1] ?? "";

  // Le titre est la dernière ligne utile : ni la date, ni le type, ni le sigle.
  const skip = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)$/i;
  const title = [...ev.lines].reverse().find((l) =>
    l.length > 3 && !skip.test(l) && !/^\d/.test(l)
    && !/travail\s+à\s+remettre|évaluation/i.test(l) && !/gr\.\s*\d/.test(l)) ?? "";
  if (!title) return null;

  const course = ev.lines.find((l) => /gr\.\s*\d/.test(l))
    ? ev.lines[ev.lines.findIndex((l) => /gr\.\s*\d/.test(l)) - 1] ?? ""
    : "";

  return {
    id: "e" + [...(code + title + date)].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36),
    t: weight ? `${title} (${weight} %)` : title,
    course: (course || code).trim(),
    date,
    time,
    kind: isExam ? "examen" : "remise",
    src: "lea",
    code,
    done: false,
  };
}

export async function collectEvenements(page: Page): Promise<Deadline[]> {
  log.step("Collecte des évènements (accueil Omnivox)");
  const cards = await readEventCards(page);
  log.info(`${cards.length} cartes d'évènement repérées`);
  const out: Deadline[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const d = parseEvent(c);
    if (d && !seen.has(d.id)) { seen.add(d.id); out.push(d); }
  }
  log.info(`${out.length} échéances exploitables`);
  if (cards.length && !out.length)
    log.warn("Des cartes ont été vues mais aucune n'a pu être lue — le gabarit a changé, lance `npm run discover`.");
  return out;
}
