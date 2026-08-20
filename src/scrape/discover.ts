import type { Page } from "playwright";
import { config, urls } from "../config.js";
import { log } from "../log.js";
import { fileStore } from "../store.js";
import { join } from "node:path";

/**
 * Étape obligatoire avant d'écrire un parser : relever la vraie structure de
 * navigation du portail. On ne devine pas les URL de Léa et des MIO — on lit
 * les liens réels de la page d'accueil connectée.
 *
 * Aucune valeur de formulaire, aucun cookie, aucun contenu de message n'est
 * enregistré : uniquement des libellés et des chemins, avec les paramètres de
 * requête retirés (ils portent souvent un jeton de session).
 */
export async function discover(page: Page): Promise<void> {
  log.step("Reconnaissance de la navigation");
  await page.goto(urls.intranet, { waitUntil: "domcontentloaded" });

  const strip = (href: string) => {
    try {
      const u = new URL(href, urls.intranet);
      return u.origin === new URL(urls.intranet).origin ? u.pathname : "(externe)";
    } catch {
      return "(illisible)";
    }
  };

  const links = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((a) => ({
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
      href: (a as HTMLAnchorElement).getAttribute("href") || "",
    })),
  );

  const seen = new Set<string>();
  const clean = links
    .map((l) => ({ text: l.text, path: strip(l.href) }))
    .filter((l) => l.text && l.path !== "(externe)")
    .filter((l) => {
      const k = `${l.text}|${l.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  const frames = page.frames().map((f) => ({ name: f.name(), path: strip(f.url()) }));

  fileStore.write("navigation", { relevé: new Date().toISOString(), liens: clean, cadres: frames });
  log.info(`${clean.length} liens et ${frames.length} cadres relevés → ${join(config.dataDir, "navigation.json")}`);

  const guess = (re: RegExp) => clean.find((l) => re.test(l.text))?.path ?? null;
  const found = {
    lea: guess(/l[ée]a/i),
    mio: guess(/\bmio\b|messagerie/i),
    travaux: guess(/travaux|exercices/i),
  };
  log.info(`Candidats — Léa: ${found.lea ?? "introuvable"} · MIO: ${found.mio ?? "introuvable"}`);
  fileStore.write("navigation-candidats", found);
}
