/**
 * Étape 1 du plan, et rien d'autre: réussir la connexion et screenshoter
 * l'accueil. Aucun scraping tant que ces deux commandes ne sont pas vertes.
 *
 *   npm run login   navigateur visible, TU tapes tes identifiants, session sauvée
 *   npm run check   headless, réutilise la session, screenshot de l'accueil
 */
import { join } from "node:path";
import { openSession } from "./browser.js";
import { ensureSession, isLoggedIn, submitCredentials, isMfa, AuthRejected, CaptchaArmed } from "./auth.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { config, urls, PLACEHOLDER_MSG } from "./config.js";
import { discover } from "./scrape/discover.js";
import { collectMios, persist } from "./scrape/collect.js";
import { fetchBodies } from "./scrape/lire.js";
import { fileStore, type Deadline } from "./store.js";
import { analyzeNew } from "./scrape/agent.js";
import { pushSnapshot, fetchSuppressions } from "./sync/supabase.js";
import { extractHoraire } from "./scrape/horaire.js";
import { collectEvenements } from "./scrape/evenements.js";
import { reportFailure, reportSuccess } from "./notify.js";
import { log } from "./log.js";

const stampName = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

/**
 * Connexion MANUELLE par défaut: le navigateur s'ouvre, tu tapes tes
 * identifiants directement dans le formulaire d'Omnivox. Rien ne transite par
 * le projet, et aucune valeur d'exemple ne peut être soumise par accident.
 *
 * `npm run login -- --auto` utilise le .env, seulement s'il est vraiment rempli.
 */
/**
 * Établit une session. Le script remplit tes identifiants ; TOI seul franchis
 * l'authentification multifacteur — le code qui s'affiche, c'est à toi de le
 * saisir. Le second facteur existe précisément pour qu'un script ne puisse pas
 * s'en passer, et je n'écrirai pas de contournement.
 *
 * `--manuel` saute même le remplissage et te laisse tout taper.
 */
async function cmdLogin(): Promise<void> {
  const manuel = process.argv.includes("--manuel") || !config.hasCredentials;
  const s = await openSession({ headed: true });
  try {
    log.step("Étape 1 — établir une session");

    if (await isLoggedIn(s.page)) {
      log.info("session déjà valide, rien à faire");
    } else {
      if (manuel) {
        log.info("Connecte-toi entièrement dans la fenêtre ouverte.");
        await s.page.goto(urls.login, { waitUntil: "domcontentloaded" });
      } else {
        log.info("Je remplis ton matricule et ton mot de passe…");
        await submitCredentials(s.page);
      }

      if (isMfa(s.page)) {
        log.info("");
        log.info("  ┌──────────────────────────────────────────────────────────┐");
        log.info("  │  AUTHENTIFICATION MULTIFACTEUR                           │");
        log.info("  │  Un code s'affiche : saisis-le dans la fenêtre ouverte.  │");
        log.info("  │  Coche « se souvenir de cet appareil » si proposé —      │");
        log.info("  │  c'est ce qui allonge la durée de la session.            │");
        log.info("  └──────────────────────────────────────────────────────────┘");
        log.info("");
      }

      log.info("J'attends que tu aies terminé (jusqu'à 10 minutes)…");
      await s.page.waitForURL(
        (u) => {
          const p = u.toString();
          return !/\/Login\/Account\/Login/i.test(p) && !/\/apps\/mfa\//i.test(p);
        },
        { timeout: 10 * 60_000 },
      );
      await s.page.waitForLoadState("networkidle").catch(() => {});
      log.info(`page atteinte : ${new URL(s.page.url()).pathname}`);

      if (!(await isLoggedIn(s.page))) {
        throw new AuthRejected(
          `Sortie du flux de connexion (${new URL(s.page.url()).pathname}) mais /intr/ ` +
            "redemande le formulaire. Reste dans la fenêtre, atteins l'accueil Omnivox, puis relance.",
        );
      }
      log.info("connexion réussie");
    }

    await s.saveState();
    writeFileSync(
      join(config.dataDir, "session-meta.json"),
      JSON.stringify({ savedAt: new Date().toISOString() }, null, 2),
    );
    log.info("OK. Lance maintenant `npm run scrape`.");
  } finally {
    await s.close();
  }
}

/** Vérifie que la session tient, et dit depuis combien de temps elle existe. */
async function cmdCheck(): Promise<void> {
  const s = await openSession({ headed: false });
  try {
    log.step("Vérification de la session");
    log.info(`session ${await ensureSession(s.page, { allowLogin: false })}`);

    const metaPath = join(config.dataDir, "session-meta.json");
    if (existsSync(metaPath)) {
      const { savedAt } = JSON.parse(readFileSync(metaPath, "utf8"));
      const h = (Date.now() - new Date(savedAt).getTime()) / 36e5;
      log.info(`session établie il y a ${h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`}`);
    }

    await s.page.goto(urls.intranet, { waitUntil: "networkidle" }).catch(() => {});
    const shot = join(config.runsDir, `${stampName()}-accueil.png`);
    await s.page.screenshot({ path: shot, fullPage: true });
    await s.saveState();
    log.info(`titre: ${await s.page.title()}`);
    log.info(`screenshot → ${shot}`);
    log.warn("ce screenshot montre une page connectée (nom, DA) — dossier gitignoré");
  } finally { await s.close(); }
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
    // Relu AVANT la collecte : ce que tu as supprimé dans l'agenda ne doit ni
    // revenir dans les données, ni être resoumis à l'agent comme « connu ».
    const supprimees = await fetchSuppressions();
    const echeances = (await collectEvenements(s.page)).filter((d) => !supprimees.has(d.id));
    const miosBruts = await collectMios(s.page);
    const corps = await fetchBodies(s.page, miosBruts); // nouveaux seulement, 8 max par passage
    // L'agent reçoit toutes les échéances connues (fraîches + retenues) pour
    // dédoublonner et pouvoir reporter/annuler ce qu'un prof change en MIO.
    const prevD = fileStore.read<Deadline[]>("deadlines", []).filter((p) => !supprimees.has(p.id));
    const connues = [...echeances, ...prevD.filter((p) => !echeances.some((e) => e.id === p.id))];
    const mios = await analyzeNew(miosBruts, corps, connues);
    persist(mios, echeances, supprimees);
    const { readFileSync: rf } = await import("node:fs");
    await pushSnapshot(JSON.parse(rf(join(config.dataDir, "export.json"), "utf8")));
    await s.saveState();
    await reportSuccess();
  } finally { await s.close(); }
}

/** Extrait l'horaire d'une capture/photo, l'enregistre et le pousse au nuage. */
async function cmdHoraire(): Promise<void> {
  const img = process.argv[3];
  if (!img) {
    log.error("Usage : npm run horaire <chemin-de-l-image>");
    log.error("Astuce : tape « npm run horaire » puis GLISSE l'image dans le Terminal.");
    process.exit(2);
  }
  await extractHoraire(img.trim());
  const { readFileSync: rf } = await import("node:fs");
  await pushSnapshot(JSON.parse(rf(join(config.dataDir, "horaire.json"), "utf8")), "horaire");
}

const commands: Record<string, () => Promise<void>> = {
  login: cmdLogin, check: cmdCheck, discover: cmdDiscover, scrape: cmdScrape, horaire: cmdHoraire,
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
  const bloquant = err instanceof CaptchaArmed || err instanceof AuthRejected;
  // Seule la collecte planifiée alerte : pour les commandes lancées à la main,
  // tu es déjà devant le terminal, une notification serait du bruit.
  if (name === "scrape") {
    await reportFailure(
      bloquant ? "session" : "autre",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (bloquant) {
    log.error("ARRÊT DÉFINITIF — aucun réessai automatique. Intervention humaine requise.");
    process.exit(3);
  }
  process.exit(1);
}
