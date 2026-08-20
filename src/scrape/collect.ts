import type { Page } from "playwright";
import { urls } from "../config.js";
import { log } from "../log.js";
import { fileStore, type Deadline, type Mio } from "../store.js";
import { readBiggestTable, col, toISODate, toTime } from "./table.js";

const uid = (seed: string) =>
  "s" + [...seed].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

/** Suit un lien par son libellé plutôt que par une URL devinée. */
async function follow(page: Page, re: RegExp, label: string): Promise<boolean> {
  await page.goto(urls.intranet, { waitUntil: "domcontentloaded" });
  const link = page.locator("a", { hasText: re }).first();
  if (!(await link.count())) {
    log.warn(`Lien « ${label} » introuvable sur l'accueil. Lance \`npm run discover\` et regarde data/navigation.json.`);
    return false;
  }
  await link.click();
  await page.waitForLoadState("domcontentloaded");
  return true;
}

export async function collectMios(page: Page): Promise<Mio[]> {
  log.step("Collecte des MIO");
  if (!(await follow(page, /\bmio\b|messagerie/i, "MIO"))) return [];
  const rows = await readBiggestTable(page);
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

export async function collectTravaux(page: Page): Promise<Deadline[]> {
  log.step("Collecte des travaux (Léa)");
  if (!(await follow(page, /l[ée]a/i, "Léa"))) return [];
  const sub = page.locator("a", { hasText: /travaux|exercices/i }).first();
  if (await sub.count()) {
    await sub.click();
    await page.waitForLoadState("domcontentloaded");
  }
  const rows = await readBiggestTable(page);
  log.info(`${rows.length} lignes lues dans les travaux`);

  return rows.map((r): Deadline | null => {
    const title = col(r, /travail|titre|description|activit/);
    const raw = col(r, /remise|[ée]ch[ée]ance|due|limite/);
    const date = toISODate(raw);
    const course = col(r, /cours|mati[èe]re|sigle/);
    if (!title || !date) return null;
    return {
      id: uid(title + date + course),
      t: title,
      course,
      date,
      time: toTime(raw),
      kind: (/examen|test|[ée]valuation/i.test(title) ? "examen" : "remise") as Deadline["kind"],
      src: "lea",
      done: false,
    };
  }).filter((d): d is Deadline => d !== null);
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
