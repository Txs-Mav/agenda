import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
import { config } from "./config.js";
import { log } from "./log.js";

export type Session = {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Écrit les cookies courants sur disque (fichier gitignoré). */
  saveState: () => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Ouvre un navigateur. Si un storage state existe, il est réutilisé: c'est ce
 * qui évite de se reconnecter à chaque run, et donc ce qui réduit le risque
 * d'armer le captcha conditionnel du formulaire de login.
 */
export async function openSession(opts: { headed?: boolean } = {}): Promise<Session> {
  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.runsDir, { recursive: true });

  const headed = opts.headed ?? config.headed;
  const hasState = existsSync(config.statePath);
  log.info(`navigateur: ${headed ? "visible" : "headless"}, session sauvegardée: ${hasState ? "oui" : "non"}`);

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    storageState: hasState ? config.statePath : undefined,
    locale: "fr-CA",
    timezoneId: "America/Toronto",
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    saveState: async () => {
      await context.storageState({ path: config.statePath });
      log.info(`session sauvegardée → ${config.statePath}`);
    },
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}
