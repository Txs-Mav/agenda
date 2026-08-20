/** Jetable : le panneau de connexion d'Omnivox, sans la photo d'archive du
 *  cégep (visages identifiables + image qui ne nous appartient pas). */
import { chromium } from "playwright";

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "fr-CA" });
const p = await ctx.newPage();
await p.goto("https://cegeptr.omnivox.ca/", { waitUntil: "networkidle" }).catch(() => {});
await p.waitForTimeout(1000);
await p.addStyleTag({ content: `
  *{background-image:none !important}
  html,body{background:#fff !important}
  img:not([src*="logo"]):not([src*="Logo"]){visibility:hidden !important}
  video{display:none !important}
` });
await p.waitForTimeout(400);
const box = await p.evaluate(() => {
  const f = document.querySelector("form") || document.querySelector("#f");
  const r = (f as HTMLElement)?.getBoundingClientRect();
  return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
});
console.log("form box:", JSON.stringify(box));
await p.screenshot({ path: "public/img/omnivox-login.png", clip: { x: 968, y: 48, width: 448, height: 640 } });
await p.screenshot({ path: "data/runs/omni-plein.png" });
await b.close();
