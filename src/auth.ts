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
  await Promise.all([
    page.waitForLoadState("domcontentloaded"),
    page.click(SEL.submit),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});

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
    throw new AuthRejected("Session expirée et connexion automatique désactivée pour ce run.");
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
