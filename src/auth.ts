import type { Page } from "playwright";
import { config, urls } from "./config.js";
import { log } from "./log.js";

/** Erreur d'identifiants: ne JAMAIS réessayer après celle-ci. */
export class AuthRejected extends Error {
  readonly retryable = false;
}
/** Le captcha conditionnel s'est armé: intervention humaine requise. */
export class CaptchaArmed extends Error {
  readonly retryable = false;
}

const SEL = {
  form: "#formLogin",
  user: "#formLogin input[name='NoDA']",
  pass: "#formLogin input[name='PasswordEtu']",
  submit: "#formLogin button[type='submit'], #formLogin .recaptcha-trigger",
} as const;

/**
 * Relevé structurel d'une page, sans aucun contenu personnel : chemin, titre,
 * présence de marqueurs connus, cadres. Sert à comprendre où le flux se casse
 * sans avoir à regarder une capture d'une page connectée.
 */
export async function diagnose(page: Page, tag: string): Promise<void> {
  const info = await page.evaluate(() => {
    const txt = document.body?.innerText || "";
    const has = (re: RegExp) => re.test(txt);
    return {
      titre: document.title,
      formulaireLogin: !!document.querySelector("#formLogin"),
      liens: [...document.querySelectorAll("a")].length,
      marqueurs: {
        lea: has(/\bL[ée]a\b/), mio: has(/\bMio\b/i),
        mesServices: has(/Mes\s+Services/i),
        evenements: has(/[ÉE]v[èe]nements/i),
        premiereUtilisation: has(/premi[èe]re\s+utilisation/i),
        conditions: has(/conditions\s+d'utilisation|j'accepte/i),
        erreur: has(/incorrect|invalide|erreur|verrouill/i),
      },
      champs: [...document.querySelectorAll("input")].map((i) => i.getAttribute("name") || i.type),
    };
  });
  log.info(`[${tag}] ${new URL(page.url()).pathname} · « ${info.titre} »`);
  log.info(`[${tag}] formulaire=${info.formulaireLogin} liens=${info.liens} champs=${JSON.stringify(info.champs)}`);
  log.info(`[${tag}] marqueurs=${JSON.stringify(info.marqueurs)}`);
  const frames = page.frames().map((f) => { try { return new URL(f.url()).pathname; } catch { return "?"; } });
  if (frames.length > 1) log.info(`[${tag}] cadres=${JSON.stringify(frames)}`);
}

/**
 * Vérifie l'état de session AVANT de parser quoi que ce soit. Sans ça, toute
 * panne en aval ressemble à une erreur de parsing.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  await page.goto(urls.intranet, { waitUntil: "domcontentloaded" });
  // Omnivox renvoie vers /Login/Account/Login quand la session est morte.
  if (/\/Login\/Account\/Login/i.test(page.url())) return false;
  if ((await page.locator(SEL.form).count()) > 0) return false;
  return true;
}

/** Vrai si Omnivox a armé son captcha conditionnel sur cette page. */
export async function captchaIsArmed(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as { grecaptcha?: unknown };
    return (
      typeof w.grecaptcha !== "undefined" ||
      document.querySelectorAll(".g-recaptcha, [name='g-recaptcha-response']").length > 0
    );
  });
}

/**
 * UNE seule tentative de connexion. Toute erreur est terminale par conception:
 * répéter une auth échouée arme le captcha puis verrouille le DA.
 */
/** Remplit et soumet le formulaire. S'arrête là : la suite peut être une MFA. */
export async function submitCredentials(page: Page): Promise<void> {
  log.step("saisie des identifiants");
  await page.goto(urls.login, { waitUntil: "domcontentloaded" });

  if (await captchaIsArmed(page)) {
    throw new CaptchaArmed(
      "Omnivox a armé son captcha sur le formulaire. Connecte-toi entièrement à la main.",
    );
  }
  await page.fill(SEL.user, config.user);
  await page.fill(SEL.pass, config.pass);
  await page.click(SEL.submit);
  await page
    .waitForURL((u) => !/\/Login\/Account\/Login/i.test(u.toString()), { timeout: 30_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  log.info(`page après soumission : ${new URL(page.url()).pathname}`);
}

/** Vrai si la page courante est l'étape multifacteur. */
export const isMfa = (page: Page): boolean => /\/apps\/mfa\//i.test(page.url());

export async function login(page: Page): Promise<void> {
  log.step("connexion");
  await page.goto(urls.login, { waitUntil: "domcontentloaded" });

  if (await captchaIsArmed(page)) {
    throw new CaptchaArmed(
      "Omnivox a armé son captcha sur le formulaire de login. Reconnecte-toi à la main " +
        "avec `npm run login` (navigateur visible), puis relance. Aucun contournement automatique.",
    );
  }

  await page.fill(SEL.user, config.user);
  await page.fill(SEL.pass, config.pass);
  await page.click(SEL.submit);
  // Le bouton porte la classe `recaptcha-trigger` : la soumission réelle passe
  // par du JavaScript, parfois de façon asynchrone. On attend donc de QUITTER
  // l'URL de login plutôt que de se fier à un état de chargement, qui peut se
  // résoudre avant que la navigation ait commencé.
  await page
    .waitForURL((u) => !/\/Login\/Account\/Login/i.test(u.toString()), { timeout: 30_000 })
    .catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  log.info(`page après soumission : ${new URL(page.url()).pathname}`);
  await diagnose(page, "après-soumission");

  if (/\/apps\/mfa\//i.test(page.url())) {
    throw new CaptchaArmed(
      "Omnivox demande une authentification multifacteur. Un script ne peut pas la franchir : " +
        "lance `npm run login` (navigateur visible), valide le second facteur à la main, " +
        "et la session sera réutilisée par les collectes suivantes.",
    );
  }

  if ((await page.locator(SEL.form).count()) > 0) {
    // Toujours sur le formulaire: identifiants refusés, ou captcha armé en réaction.
    if (await captchaIsArmed(page)) {
      throw new CaptchaArmed("Captcha armé après la tentative. Connexion manuelle requise.");
    }
    const msg = await page
      .locator(".message-erreur, .erreur, [class*='error']")
      .first()
      .textContent()
      .catch(() => null);
    throw new AuthRejected(
      `Identifiants refusés par Omnivox${msg ? ` (${msg.trim().slice(0, 120)})` : ""}. ` +
        `Aucun réessai: des tentatives répétées verrouillent le DA.`,
    );
  }
  log.info("connexion acceptée");
}

/**
 * Réutilise la session existante si elle est vivante, sinon se connecte une
 * fois. `allowLogin: false` sert aux runs planifiés qu'on veut voir échouer
 * bruyamment plutôt que de tenter une auth non surveillée.
 */
export async function ensureSession(
  page: Page,
  opts: { allowLogin?: boolean } = {},
): Promise<"réutilisée" | "nouvelle"> {
  if (await isLoggedIn(page)) return "réutilisée";
  if (opts.allowLogin === false) {
    throw new AuthRejected(
      "Aucune session valide. Cette commande ne s'authentifie jamais (ton cégep exige une " +
      "authentification multifacteur). Lance `npm run login` : je remplis tes identifiants, " +
      "tu saisis le code, et toutes les collectes suivantes réutilisent la session.",
    );
  }
  if (!config.hasCredentials) {
    throw new AuthRejected(
      "Session expirée et aucun identifiant dans l'environnement. Lance `npm run login`.",
    );
  }
  await login(page);
  if (!(await isLoggedIn(page))) {
    throw new AuthRejected("Connexion apparemment acceptée mais la session n'est pas valide.");
  }
  return "nouvelle";
}
