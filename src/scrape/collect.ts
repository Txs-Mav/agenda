import type { Page } from "playwright";
import { urls } from "../config.js";
import { log } from "../log.js";
import { fileStore, type Deadline, type Mio } from "../store.js";
import { readBiggestTable, col, toISODate, toTime } from "./table.js";

const uid = (seed: string) =>
  "s" + [...seed].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

export async function collectMios(page: Page): Promise<Mio[]> {
  log.step("Collecte des MIO");
  await page.goto(urls.mio, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // La boîte peut vivre dans un cadre : on prend la portée qui a le plus de lignes.
  const scopes = [page, ...page.frames()];
  let rows = await readBiggestTable(page);
  for (const f of scopes) {
    const r = await readBiggestTable(f as never).catch(() => []);
    if (r.length > rows.length) rows = r;
  }
  log.info(`${rows.length} lignes lues dans la boîte MIO`);

  return rows.map((r) => {
    const from = col(r, /exp[ée]diteur|de\b|auteur/);
    const subject = col(r, /objet|sujet/);
    const date = toISODate(col(r, /date|re[çc]u/));
    return {
      id: uid(from + subject + date),
      from,
      course: "",
      date: date || new Date().toISOString().slice(0, 10),
      subject,
      // Le résumé est produit hors ligne par summarize.ts ; ici on ne garde
      // que ce que la liste expose, sans ouvrir chaque message.
      summary: "",
      add: null,
    } satisfies Mio;
  }).filter((m) => m.subject);
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
  fileStore.write("export", {
    lastScrape: new Date().toISOString(),
    mios: nextM,
    deadlines: nextD,
  });
  log.info(`${nextM.length} MIO et ${nextD.length} échéances enregistrés`);
}
