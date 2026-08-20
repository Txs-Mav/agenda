import type { Page } from "playwright";
import { urls } from "../config.js";
import { log } from "../log.js";
import type { Deadline } from "../store.js";

/**
 * Les évènements de l'accueil Omnivox sont des cartes `.carte-evenement`. La
 * structure réelle, relevée sur la page (pas devinée), est une liste de lignes
 * propres :
 *   [jour de semaine] [numéro] [mois] [heure?] [TYPE] [cours] [sigle gr.] [titre]
 * On lit ces lignes par leur rôle — bien plus robuste qu'une regex sur le texte
 * concaténé, et insensible à l'ordre exact.
 */
const MOIS = ["janvier","février","mars","avril","mai","juin",
              "juillet","août","septembre","octobre","novembre","décembre"];
const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type RawCard = { lines: string[] };

export async function readEventCards(page: Page): Promise<RawCard[]> {
  await page.goto(urls.intranet, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.evaluate(() => {
    const clean = (el: HTMLElement) =>
      (el.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);

    const cards = [...document.querySelectorAll<HTMLElement>(".carte-evenement")];
    if (cards.length) return cards.map((el) => ({ lines: clean(el) }));

    // Repli si la classe change un jour : remonter depuis les blocs de type
    // colorés jusqu'à l'ancêtre qui porte une date.
    const MOISRE = /janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre/i;
    const types = [...document.querySelectorAll<HTMLElement>("[class*='couleur_TRAV'],[class*='couleur_EVAL']")];
    const seen = new Set<HTMLElement>();
    const out: HTMLElement[] = [];
    for (const t of types) {
      let el: HTMLElement | null = t;
      for (let i = 0; i < 6 && el; i++) { if (MOISRE.test(el.innerText || "")) break; el = el.parentElement; }
      if (el && !seen.has(el)) { seen.add(el); out.push(el); }
    }
    return out.map((el) => ({ lines: clean(el) }));
  });
}

/** Une carte → une échéance, ou null si la structure ne s'y prête pas. */
export function parseCard(lines: string[], today = new Date()): Deadline | null {
  const dayLine = lines.find((l) => /^\d{1,2}$/.test(l));
  const monthLine = lines.find((l) => MOIS.some((m) => strip(m) === strip(l)));
  if (!dayLine || !monthLine) return null;
  const day = Number(dayLine);
  const mIdx = MOIS.findIndex((m) => strip(m) === strip(monthLine));
  if (mIdx < 0 || !day) return null;

  // Les cartes n'affichent pas l'année : année courante, sauf si la date est à
  // plus de 3 mois dans le passé — alors c'est la session suivante.
  let year = today.getFullYear();
  if ((today.getTime() - new Date(year, mIdx, day).getTime()) / 864e5 > 90) year += 1;
  const date = `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const timeLine = lines.find((l) => /^\d{1,2}\s*[h:]\s*\d{2}$/.test(l));
  const tm = timeLine ? /(\d{1,2})\s*[h:]\s*(\d{2})/.exec(timeLine) : null;
  const time = tm ? `${tm[1]!.padStart(2, "0")}:${tm[2]}` : "";

  const typeLine = lines.find((l) => /travail\s+à\s+remettre|évaluation/i.test(l)) ?? "";
  const isExam = /évaluation/i.test(typeLine);
  const weight = /\((\d+(?:[.,]\d+)?)\s*%\)/.exec(typeLine)?.[1] ?? "";

  const codeIdx = lines.findIndex((l) => /\d{3}-\w{3}-\w{2}/.test(l));
  if (codeIdx < 0) return null;
  const code = /(\d{3}-\w{3}-\w{2})/.exec(lines[codeIdx]!)?.[1] ?? "";
  const course = lines[codeIdx - 1] ?? "";
  const title = lines.slice(codeIdx + 1).join(" ").trim();
  if (!title) return null;

  return {
    id: "e" + [...(code + title + date)].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36),
    t: weight ? `${title} (${weight} %)` : title,
    course, date, time,
    kind: isExam ? "examen" : "remise",
    src: "lea", code, done: false,
  };
}

export async function collectEvenements(page: Page): Promise<Deadline[]> {
  log.step("Collecte des évènements (accueil Omnivox)");
  const cards = await readEventCards(page);
  log.info(`${cards.length} cartes repérées`);
  const out: Deadline[] = [];
  const seen = new Set<string>();
  for (const c of cards) {
    const d = parseCard(c.lines);
    if (d && !seen.has(d.id)) { seen.add(d.id); out.push(d); }
  }
  log.info(`${out.length} échéances exploitables`);
  if (cards.length && !out.length)
    log.warn("Des cartes ont été vues mais aucune n'a pu être lue — le gabarit a changé.");
  return out;
}
