import type { Page } from "playwright";
import { urls } from "../config.js";
import { log } from "../log.js";
import { fileStore, type Deadline, type Mio } from "../store.js";
import { readBiggestTable, col, toISODate, toTime } from "./table.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const uid = (seed: string) =>
  "s" + [...seed].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

export async function collectMios(page: Page): Promise<Mio[]> {
  log.step("Collecte des MIO");
  await page.goto(urls.mio, { waitUntil: "networkidle" }).catch(() => {});

  // La boîte de réception vit dans un cadre imbriqué (MioListe.aspx),
  // table#lstMIO. On la cherche dans tous les cadres plutôt que de deviner.
  let rows: string[][] = [];
  for (const f of [page, ...page.frames()]) {
    const r = await (f as never as typeof page).evaluate(() => {
      const clean = (x: string | null) => (x || "").replace(/\s+/g, " ").trim();
      const t = document.querySelector("#lstMIO");
      if (!t) return null;
      return [...t.querySelectorAll("tr")]
        .map((tr) => [...tr.querySelectorAll("td")].map((td) => clean(td.textContent)).filter(Boolean))
        .filter((cells) => cells.length >= 3);
    }).catch(() => null);
    if (r && r.length) { rows = r; break; }
  }
  log.info(`${rows.length} messages dans la boîte de réception`);

  const out: Mio[] = [];
  for (const cells of rows) {
    const dateLike = (c: string) => /^\d{1,2}\s*[h:]\s*\d{2}$/.test(c)
      || /^\d{1,2}\s+(janv|févr|mars|avr|mai|juin|juil|août|sept|octo|nove|déce)/i.test(c)
      || /\d{4}-\d{2}-\d{2}/.test(c)
      || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c);
    const status = cells.find((c) => /message\s+(lu|non\s*lu)/i.test(c)) ?? "";
    const when = cells.find(dateLike) ?? "";
    // Ni statut, ni date, ni bouton d'action : ne restent que expéditeur et objet.
    const rest = cells.filter((c) =>
      c !== status && !dateLike(c) && !/catégoriser|supprimer|répondre|transférer/i.test(c));
    if (!rest.length) continue;
    const sorted = [...rest].sort((a, b) => a.length - b.length);
    const from = sorted[0] ?? "";
    const subject = sorted[sorted.length - 1] ?? "";
    if (!from || !subject || from === subject) continue;

    // Sans année ni ouverture du message : si l'heure seule est affichée, c'est
    // aujourd'hui ; sinon on garde le libellé tel quel côté date.
    const isTime = /^\d{1,2}\s*[h:]\s*\d{2}$/.test(when);
    const date = isTime ? new Date().toISOString().slice(0, 10)
      : (toISODate(when) || new Date().toISOString().slice(0, 10));

    out.push({
      id: uid(from + subject + date),
      from,
      course: "",
      date,
      subject,
      // Aperçu de la liste. Le vrai résumé en une phrase (ouverture du message
      // + API Claude) reste à ajouter — cf. src/scrape/summarize.ts à venir.
      summary: subject,
      add: null,
    });
  }
  log.info(`${out.length} MIO exploitables`);
  return out;
}

/**
 * Fusionne avec l'existant : ce que tu as coché « fait » ou saisi à la main
 * survit à une collecte. Une entrée scrapée qui disparaît d'Omnivox est
 * conservée si tu l'avais déjà marquée faite.
 */
export function merge<T extends { id: string }>(previous: T[], fresh: T[], keep: (x: T) => boolean): T[] {
  const byId = new Map(previous.map((x) => [x.id, x]));
  const out: T[] = [];
  for (const f of fresh) out.push({ ...f, ...(byId.get(f.id) ?? {}) } as T);
  const freshIds = new Set(fresh.map((f) => f.id));
  for (const p of previous) if (!freshIds.has(p.id) && keep(p)) out.push(p);
  return out;
}

export function persist(mios: Mio[], deadlines: Deadline[]): void {
  const prevM = fileStore.read<Mio[]>("mios", []);
  const prevD = fileStore.read<Deadline[]>("deadlines", []);
  const nextM = merge(prevM, mios, () => false);
  const nextD = merge(prevD, deadlines, (d) => d.src === "manuel" || d.done);
  fileStore.write("mios", nextM);
  fileStore.write("deadlines", nextD);
  const payload = { lastScrape: new Date().toISOString(), mios: nextM, deadlines: nextD };
  fileStore.write("export", payload);
  // Copie servie par l'interface (public/data.json est gitignoré : données
  // personnelles, jamais committées ni déployées sur l'URL publique).
  try {
    writeFileSync(join(process.cwd(), "public", "data.json"), JSON.stringify(payload, null, 2));
  } catch {}
  log.info(`${nextM.length} MIO et ${nextD.length} échéances enregistrés`);
}
