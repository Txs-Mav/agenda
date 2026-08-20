/**
 * Étape 1 du plan, et rien d'autre: réussir la connexion et screenshoter
 * l'accueil. Aucun scraping tant que ces deux commandes ne sont pas vertes.
 *
 *   npm run login   navigateur visible, TU tapes tes identifiants, session sauvée
 *   npm run check   headless, réutilise la session, screenshot de l'accueil
 */
import { join } from "node:path";
import { openSession } from "./browser.js";
import { ensureSession, isLoggedIn, AuthRejected, CaptchaArmed } from "./auth.js";
import { config, urls, PLACEHOLDER_MSG } from "./config.js";
import { log } from "./log.js";

const stampName = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/**
 * Connexion MANUELLE par défaut: le navigateur s'ouvre, tu tapes tes
 * identifiants directement dans le formulaire d'Omnivox. Rien ne transite par
 * le projet, et aucune valeur d'exemple ne peut être soumise par accident.
 *
 * `npm run login -- --auto` utilise le .env, seulement s'il est vraiment rempli.
 */
async function cmdLogin(): Promise<void> {
  const auto = process.argv.includes("--auto");
  const s = await openSession({ headed: true });
  try {
    log.step("Étape 1a — établir une session");

    if (await isLoggedIn(s.page)) {
      log.info("session déjà valide, rien à faire");
    } else if (auto) {
      if (!config.hasCredentials) throw new AuthRejected(PLACEHOLDER_MSG);
      await ensureSession(s.page);
    } else {
      log.info("Connecte-toi dans la fenêtre qui vient de s'ouvrir.");
      log.info("Je n'écris rien dans le formulaire et je ne lis pas ce que tu tapes.");
      await s.page.goto(urls.login, { waitUntil: "domcontentloaded" });
      await s.page.waitForURL((u) => !/\/Login\/Account\/Login/i.test(u.toString()), {
        timeout: 5 * 60_000,
      });
      if (!(await isLoggedIn(s.page))) {
        throw new AuthRejected("La page a changé mais la session n'est pas valide.");
      }
      log.info("connexion réussie");
    }

    await s.saveState();
    log.info("OK. Lance `npm run check`, puis relance-le dans 30 min.");
  } finally {
    await s.close();
  }
}

async function cmdCheck(): Promise<void> {
  const s = await openSession({ headed: false });
  try {
    log.step("Étape 1b — vérifier la session et screenshoter l'accueil");
    const how = await ensureSession(s.page);
    log.info(`session ${how}`);

    await s.page.goto(urls.intranet, { waitUntil: "networkidle" }).catch(() => {});
    const shot = join(config.runsDir, `${stampName()}-accueil.png`);
    await s.page.screenshot({ path: shot, fullPage: true });
    await s.saveState();

    log.info(`titre: ${await s.page.title()}`);
    log.info(`screenshot → ${shot}`);
    log.warn("ce screenshot montre une page connectée (nom, DA) — dossier gitignoré, ne le partage pas");
  } finally {
    await s.close();
  }
}

const commands: Record<string, () => Promise<void>> = { login: cmdLogin, check: cmdCheck };

const name = process.argv[2] ?? "";
const run = commands[name];
if (!run) {
  log.error(`commande inconnue: "${name}". Disponibles: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
try {
  await run();
} catch (err) {
  log.error(err);
  if (err instanceof CaptchaArmed || err instanceof AuthRejected) {
    log.error("ARRÊT DÉFINITIF — aucun réessai automatique. Intervention humaine requise.");
    process.exit(3);
  }
  process.exit(1);
}
