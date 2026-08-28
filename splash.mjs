/**
 * Peint les écrans de démarrage iOS dans public/splash/ — à relancer
 * seulement si l'icône ou la table des formats change :
 *
 *   node splash.mjs
 *
 * Le fond reprend le background_color du manifeste (ce qu'iOS peint autour) ;
 * l'icône ronde au centre, à un cinquième du petit côté. Chromium sert de
 * pinceau : c'est la seule dépendance du projet qui sache écrire un PNG.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SPLASH, nomSplash } from "./splash-sizes.mjs";

const FOND = "#1F2123";   // = background_color du manifeste
const icone = readFileSync("public/icon-512.png").toString("base64");

mkdirSync("public/splash", { recursive: true });
const nav = await chromium.launch();
const page = await nav.newPage();

const peindre = async (w, h, r, paysage) => {
  const [pw, ph] = paysage ? [h * r, w * r] : [w * r, h * r];
  const bord = Math.round(Math.min(pw, ph) * 0.2);
  await page.setViewportSize({ width: pw, height: ph });
  await page.setContent(`<!doctype html><body style="margin:0;width:${pw}px;height:${ph}px;
    background:${FOND};display:grid;place-items:center">
    <img src="data:image/png;base64,${icone}" style="width:${bord}px;height:${bord}px;border-radius:22%">
  </body>`);
  await page.screenshot({ path: `public/${nomSplash(w, h, r, paysage)}` });
};

let n = 0;
for (const [w, h, r] of SPLASH) {
  await peindre(w, h, r, false); n++;
  if (w >= 744) { await peindre(w, h, r, true); n++; }
}
await nav.close();
console.log(`${n} écrans de démarrage peints dans public/splash/`);
