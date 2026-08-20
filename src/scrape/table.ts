import type { Page, Frame } from "playwright";

/**
 * Omnivox est du vieux ASP.NET : les classes CSS changent d'un module à
 * l'autre et d'un cégep à l'autre. Plutôt que de deviner des sélecteurs, on
 * lit la plus grosse table de la page et on associe les colonnes par leur
 * en-tête. Ça survit à un changement de gabarit ; un changement d'intitulé de
 * colonne fait échouer bruyamment, ce qui est le comportement voulu.
 */
export type Row = Record<string, string>;

export async function readBiggestTable(scope: Page | Frame): Promise<Row[]> {
  return scope.evaluate(() => {
    const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
    const tables = [...document.querySelectorAll("table")];
    if (!tables.length) return [];
    const best = tables.reduce((a, b) =>
      b.querySelectorAll("tr").length > a.querySelectorAll("tr").length ? b : a);

    const rows = [...best.querySelectorAll("tr")];
    if (rows.length < 2) return [];

    const headCells = [...(rows[0]?.querySelectorAll("th,td") ?? [])].map((c) => clean(c.textContent));
    const heads = headCells.map((h, i) => h || `col${i}`);

    return rows.slice(1).map((tr) => {
      const cells = [...tr.querySelectorAll("td,th")].map((c) => clean(c.textContent));
      const out: Record<string, string> = {};
      cells.forEach((v, i) => { out[heads[i] ?? `col${i}`] = v; });
      return out;
    }).filter((r) => Object.values(r).some(Boolean));
  });
}

/** Cherche une colonne dont l'intitulé correspond, insensible aux accents. */
export function col(row: Row, ...patterns: RegExp[]): string {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const p of patterns) {
    const k = Object.keys(row).find((key) => p.test(norm(key)));
    if (k && row[k]) return row[k];
  }
  return "";
}

/** Convertit « 12 septembre 2026 » ou « 2026-09-12 » ou « 12/09/2026 » en AAAA-MM-JJ. */
export function toISODate(raw: string, fallbackYear = new Date().getFullYear()): string {
  const s = raw.trim();
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  const MOIS = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "octo", "nove", "déce"];
  m = /(\d{1,2})\s+([a-zà-ÿ]+)\.?\s*(\d{4})?/i.exec(s);
  if (m) {
    const norm = (m[2] ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const idx = MOIS.findIndex((x) =>
      norm.startsWith(x.normalize("NFD").replace(/[̀-ͯ]/g, "")));
    if (idx >= 0) {
      const y = m[3] ? Number(m[3]) : fallbackYear;
      return `${y}-${String(idx + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    }
  }
  return "";
}

/** Extrait « 14h00 », « 14:00 » ou « 14 h 00 ». */
export function toTime(raw: string): string {
  const m = /(\d{1,2})\s*[h:]\s*(\d{2})/.exec(raw);
  return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : "";
}
