/** Jetable : captures pour la page d'accueil.
 *  Noms d'enseignants remplacés AVANT le rendu (interception de data.json et
 *  horaire.json) — une capture publique ne doit identifier personne. */
import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:4179";
const OUT = "public/img";

const ANON: [string, string][] = [
  ["Emilie Alexander", "Anne Tremblay"],
  ["Marie-Geneviève Ricard", "Marie Bergeron"],
  ["François Gagnon", "Félix Lavoie"],
  ["Marianne Mathis", "Sarah Côté"],
  ["\"from\":\"Ko\"", "\"from\":\"Services aux étudiants\""],
  ["Alexander, E · Colbert, M", "Tremblay, A · Roy, M"],
  ["Cinq-Mars, L", "Bergeron, L"],
  ["Morissette, J", "Tremblay, J"],
  ["Gagnon, F", "Lavoie, F"],
  ["Letarte, J", "Fortin, J"],
  ["Mathis, M", "Côté, S"],
];
const anon = (t: string) => ANON.reduce((s, [a, b]) => s.split(a).join(b), t);

const b = await chromium.launch({ headless: true });

async function shoot(name: string, theme: "dark" | "light", w: number, h: number,
                     go: (p: Page) => Promise<void>, clip?: string) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, locale: "fr-CA" });
  const p = await ctx.newPage();
  for (const f of ["data", "horaire"]) {
    await p.route(`**/${f}.json*`, (route) => route.fulfill({
      contentType: "application/json", body: anon(readFileSync(`public/${f}.json`, "utf8")) }));
  }
  await p.addInitScript(([th]) => {
    document.cookie = "agenda_vu=1;path=/;max-age=99999999";
    localStorage.setItem("agenda.v5", JSON.stringify({
      theme: th, name: "Alex", wks: [0], wview: "une", wcur: 0 }));
  }, [theme]);
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.waitForTimeout(1400);
  await go(p);
  await p.waitForTimeout(1100);
  const t = clip ? p.locator(clip) : null;
  await (t ? t.screenshot({ path: `${OUT}/${name}.png` }) : p.screenshot({ path: `${OUT}/${name}.png` }));
  console.log("→", name);
  await ctx.close();
}

const enter = async (p: Page) => { await p.evaluate(() => (document.getElementById("cta-open") as HTMLElement)?.click()); };
const goto_ = (id: string) => async (p: Page) => {
  await enter(p);
  await p.evaluate((i) => document.querySelector<HTMLElement>(`.navi[data-go="${i}"]`)?.click(), id);
  await p.waitForTimeout(700);
};

await shoot("app-tableau", "dark", 1440, 940, enter);
await shoot("app-tableau-clair", "light", 1440, 940, enter);
await shoot("app-echeances", "light", 1180, 860, goto_("echeances"), "#echeances");
await shoot("app-mios", "light", 1180, 860, goto_("mios"), "#mios");
await shoot("app-horaire", "dark", 1440, 940, goto_("horaire"));

/* Omnivox : seul le panneau de connexion — pas la photo d'archive du cégep,
   qui appartient à quelqu'un d'autre et montre des visages identifiables. */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "fr-CA" });
  const p = await ctx.newPage();
  await p.goto("https://cegeptr.omnivox.ca/", { waitUntil: "networkidle" }).catch(() => {});
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/omnivox-login.png`, clip: { x: 940, y: 40, width: 500, height: 830 } });
  console.log("→ omnivox-login");
  await ctx.close();
}

await b.close();
