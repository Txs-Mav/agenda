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
import { discover } from "./scrape/discover.js";
import { collectMios, persist } from "./scrape/collect.js";
import { collectEvenements } from "./scrape/evenements.js";
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
      log.info("Ton cégep a une authentification multifacteur : franchis aussi cette étape.");
      log.info("Je n'écris rien dans le formulaire et je ne lis pas ce que tu tapes.");
      log.info("J'attends jusqu'à 10 minutes, puis j'enregistre la session.");
      await s.page.goto(urls.login, { waitUntil: "domcontentloaded" });
      // On attend d'avoir quitté le formulaire ET l'étape multifacteur.
      await s.page.waitForURL(
        (u) => {
          const p = u.toString();
          return !/\/Login\/Account\/Login/i.test(p) && !/\/apps\/mfa\//i.test(p);
        },
        { timeout: 10 * 60_000 },
      );
      log.info(`page atteinte : ${new URL(s.page.url()).pathname}`);
      if (!(await isLoggedIn(s.page))) {
        throw new AuthRejected(
          `La page a changé (${new URL(s.page.url()).pathname}) mais /intr/ redemande le formulaire. ` +
          "Reste connecté dans la fenêtre et relance : si une page intermédiaire s'affiche " +
          "(première utilisation, avis à accepter), franchis-la à la main d'abord.",
        );
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

/** Relève la navigation réelle du portail (aucun contenu, seulement des chemins). */
async function cmdDiscover(): Promise<void> {
  const s = await openSession({ headed: false });
  try {
    // allowLogin:false — seul `npm run login` a le droit de s'authentifier.
    await ensureSession(s.page, { allowLogin: false });
    await discover(s.page);
    await s.saveState();
  } finally { await s.close(); }
}

/** Une collecte : MIO + travaux Léa, fusionnés avec l'existant. */
async function cmdScrape(): Promise<void> {
  const s = await openSession({ headed: false });
  try {
    log.step("Collecte Omnivox");
    // Une tâche horaire ne doit JAMAIS pouvoir tenter une connexion : c'est
    // ainsi qu'on arme le captcha puis qu'on verrouille le DA. Elle exige une
    // session déjà établie par `npm run login`, et échoue bruyamment sinon.
    log.info(`session ${await ensureSession(s.page, { allowLogin: false })}`);
    const echeances = await collectEvenements(s.page);
    const mios = await collectMios(s.page);
    persist(mios, echeances);
    await s.saveState();
  } finally { await s.close(); }
}

const commands: Record<string, () => Promise<void>> = {
  login: cmdLogin, check: cmdCheck, discover: cmdDiscover, scrape: cmdScrape,
};

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
