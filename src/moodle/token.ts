/**
 * Obtenir le jeton de service web Moodle — une fois, durable ensuite.
 *
 *   npm run moodle-login                 compte local du .env si présent, sinon SSO
 *   npm run moodle-login -- --sso        force le navigateur (connexion M365)
 *   npm run moodle-login -- --jeton XYZ  enregistre un jeton déjà en main
 *
 * Deux chemins, jamais de contournement :
 *  - compte local : login/token.php avec MOODLE_USER / MOODLE_PASS du .env —
 *    identiques aux règles Omnivox, jamais dans le chat, jamais commités ;
 *  - SSO M365 : le flux officiel de l'app mobile (tool/mobile/launch.php)
 *    s'ouvre dans un navigateur visible, TU te connectes, et le jeton revient
 *    par la redirection moodlemobile:// que l'on intercepte au passage.
 */
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { MOODLE_BASE, MOODLE_HOST, ecrireJeton, lireJeton, ws, type SiteInfo } from "./api.js";
import { registerSecret } from "../redact.js";
import { log } from "../log.js";

/* Charge le .env via config (effet de bord de son import par store). */
import "../config.js";

async function valide(token: string): Promise<SiteInfo> {
  const info = await ws<SiteInfo>(token, "core_webservice_get_site_info");
  log.info(`jeton valide — connecté comme ${info.fullname} sur ${info.sitename}`);
  return info;
}

async function enregistre(token: string, privatetoken?: string): Promise<void> {
  await valide(token);
  ecrireJeton(token, privatetoken);
  log.info("jeton enregistré dans data/moodle-token.json (gitignoré).");
  log.info("Lance maintenant `npm run moodle`.");
}

/** Compte local : le chemin sans navigateur. */
async function parCompteLocal(user: string, pass: string): Promise<boolean> {
  registerSecret(user); registerSecret(pass);
  const u = new URL(`${MOODLE_BASE}/login/token.php`);
  u.searchParams.set("username", user);
  u.searchParams.set("password", pass);
  u.searchParams.set("service", "moodle_mobile_app");
  const r = await fetch(u);
  const data = (await r.json()) as { token?: string; privatetoken?: string; error?: string; errorcode?: string };
  if (data.token) {
    await enregistre(data.token, data.privatetoken);
    return true;
  }
  log.warn(`compte local refusé (${data.errorcode ?? "?"}) : ${data.error ?? "sans détail"}`);
  return false;
}

/** SSO : le flux officiel de l'app mobile, dans un navigateur visible. */
async function parSSO(): Promise<void> {
  const passport = String(Math.random() * 1000);
  const cible = `${MOODLE_BASE}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passport}&urlscheme=moodlemobile`;

  log.step("Connexion Moodle dans la fenêtre qui s'ouvre (M365 ou compte local)");
  log.info("Je n'interviens pas : tu te connectes, je ne fais qu'attendre le jeton.");

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  const jeton = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("10 minutes sans jeton — relance quand tu es prêt.")), 10 * 60_000);
    const attrape = (brut: string | null | undefined) => {
      const m = /moodlemobile:\/\/token=([A-Za-z0-9+/=%]+)/.exec(brut ?? "");
      if (!m) return;
      clearTimeout(timer);
      resolve(decodeURIComponent(m[1]!));
    };
    // La redirection finale part en moodlemobile:// — invisible comme
    // navigation, mais présente dans l'en-tête Location de la réponse.
    page.on("response", (r) => attrape(r.headers()["location"]));
    // Filet : certaines versions affichent plutôt un lien « cliquez ici ».
    const scrute = setInterval(() => {
      page.evaluate(() =>
        document.querySelector<HTMLAnchorElement>('a[href^="moodlemobile://"]')?.getAttribute("href"),
      ).then(attrape).catch(() => {});
    }, 1500);
    page.goto(cible).catch(() => {});
    page.on("close", () => { clearInterval(scrute); });
  }).finally(() => browser.close().catch(() => {}));

  // Format officiel : base64(signature:::jeton[:::jetonprivé]), la signature
  // étant md5(url du site + passport). On vérifie, on avertit sans bloquer.
  const parts = Buffer.from(jeton, "base64").toString("utf8").split(":::");
  if (parts.length < 2) throw new Error("réponse moodlemobile:// illisible — flux SSO inattendu.");
  const attendu = createHash("md5").update(MOODLE_BASE + passport).digest("hex");
  if (parts[0] !== attendu) log.warn("signature du jeton inattendue — on continue, le jeton sera validé par l'API.");
  await enregistre(parts[1]!, parts[2]);
}

const arg = (nom: string) => {
  const i = process.argv.indexOf(nom);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

try {
  const existant = lireJeton();
  if (existant && !process.argv.includes("--force")) {
    log.info(`un jeton existe déjà (obtenu le ${existant.obtenu.slice(0, 10)}) — je le vérifie…`);
    try {
      await valide(existant.token);
      log.info("rien à faire. (`--force` pour en obtenir un neuf.)");
      process.exit(0);
    } catch {
      log.warn("jeton mort — on en obtient un neuf.");
    }
  }

  const colle = arg("--jeton");
  if (colle) {
    await enregistre(colle);
  } else if (!process.argv.includes("--sso")
      && process.env.MOODLE_USER && process.env.MOODLE_PASS) {
    log.step(`Essai du compte local Moodle (${MOODLE_HOST})`);
    if (!(await parCompteLocal(process.env.MOODLE_USER, process.env.MOODLE_PASS))) {
      log.info("passage au flux SSO navigateur…");
      await parSSO();
    }
  } else {
    await parSSO();
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
