/**
 * Vérification de l'extension — `npm run ext:verifier`.
 *
 * Deux familles de contrôles, et la première est la plus importante :
 *
 *  1. LA PARITÉ DES IDENTIFIANTS. parsers.js est un port à la main de
 *     src/scrape/*.ts. Le jour où l'un des deux dérive, une même échéance
 *     reçoit deux identifiants et apparaît en double dans l'agenda — sans que
 *     rien ne plante. C'est le genre de panne qu'on ne voit qu'en production,
 *     donc on la teste ici.
 *  2. La cohérence de l'extension : aucune adresse de cégep codée en dur,
 *     chaque message envoyé est reçu, chaque champ du popup existe.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (f) => readFileSync(join(ICI, f), "utf8");

/* parsers.js s'installe sur `self` : dans Node il n'existe pas, on le pose. */
globalThis.self = globalThis;
new Function(lire("parsers.js"))();
const P = globalThis.AgendaParsers;

let echecs = 0;
const ok = (nom, cond, detail = "") => {
  if (cond) { console.log(`  ✓ ${nom}`); return; }
  echecs++;
  console.log(`  ✗ ${nom}${detail ? ` — ${detail}` : ""}`);
};

/* ---- 1. Parité avec le scraper local ------------------------------------- */
// Les formules recopiées depuis src/scrape/evenements.ts:121 et collect.ts:10.
const idEvenementTS = (code, title, date) =>
  "e" + [...(code + title + date)].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);
const idMioTS = (from, subject, date) =>
  "s" + [...(from + subject + date)].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

console.log("\nParité des identifiants avec le scraper local");
{
  const carte = ["12", "septembre", "23 h 59", "Travail à remettre (15 %)",
                 "Bio. molécu. écosys.", "101-115-RI", "Rapport de laboratoire 3"];
  const d = P.parseCard(carte, new Date(2026, 8, 1));
  ok("une carte Léa devient une échéance", !!d, "parseCard a rendu null");
  if (d) {
    ok("id d'échéance identique au scraper",
      d.id === idEvenementTS("101-115-RI", "Rapport de laboratoire 3", "2026-09-12"),
      `extension ${d.id} ≠ scraper ${idEvenementTS("101-115-RI", "Rapport de laboratoire 3", "2026-09-12")}`);
    ok("la pondération rejoint le titre", d.t === "Rapport de laboratoire 3 (15 %)", d.t);
    ok("date recomposée", d.date === "2026-09-12", d.date);
    ok("heure lue", d.time === "23:59", d.time);
    ok("genre « remise »", d.kind === "remise", d.kind);
    ok("source « lea »", d.src === "lea", d.src);
  }

  const exam = P.parseCard(["3", "octobre", "Évaluation (25 %)", "Calcul différentiel",
                            "201-124-RI", "Examen intra"], new Date(2026, 8, 1));
  ok("une évaluation devient un examen", exam?.kind === "examen", exam?.kind);
}
{
  const cells = ["Message non lu", "12 septembre 2026", "Morissette, Julie",
                 "Report de la remise du travail 2", "Répondre"];
  const m = P.parseMioCells(cells);
  ok("une ligne de la boîte devient un MIO", !!m, "parseMioCells a rendu null");
  if (m) {
    ok("id de MIO identique au scraper",
      m.id === idMioTS(m.from, m.subject, m.date),
      `extension ${m.id} ≠ scraper ${idMioTS(m.from, m.subject, m.date)}`);
    ok("expéditeur et objet démêlés",
      m.from === "Morissette, Julie" && m.subject === "Report de la remise du travail 2",
      `${m.from} / ${m.subject}`);
  }
}
{
  const cas = [["2026-09-12", "2026-09-12"], ["12/09/2026", "2026-09-12"],
               ["12 septembre 2026", "2026-09-12"], ["3 févr. 2026", "2026-02-03"]];
  for (const [brut, attendu] of cas) {
    ok(`date « ${brut} »`, P.toISODate(brut) === attendu, P.toISODate(brut));
  }
}

/* ---- 2. Cohérence de l'extension ----------------------------------------- */
console.log("\nCohérence de l'extension");
const manifest = JSON.parse(lire("manifest.json"));
const bg = lire("background.js"), pop = lire("popup.js"), popHtml = lire("popup.html");
const omni = lire("omnivox.js"), bridge = lire("bridge.js");

/* Un cégep codé en dur, et l'extension ne sert qu'à Trois-Rivières. On ne
   regarde que les CHAÎNES : les commentaires nomment des cégeps en exemple,
   et les expressions régulières doivent bien parler de « .omnivox.ca ».
   www.omnivox.ca échappe à la règle — c'est le sélecteur d'établissement,
   justement la page qu'on ouvre quand on ignore encore le cégep. */
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const enDur = [["background.js", bg], ["popup.js", pop], ["omnivox.js", omni], ["bridge.js", bridge]]
  .filter(([, src]) => [...sansCommentaires(src).matchAll(/["'`]([^"'`\n]*\.omnivox\.ca[^"'`\n]*)["'`]/g)]
    .some((m) => !m[1].includes("${") && !m[1].includes("www.omnivox.ca")))
  .map(([f]) => f);
ok("aucune adresse de cégep codée en dur", enDur.length === 0, enDur.join(", "));

// Tout message envoyé doit trouver un destinataire.
const envoyes = new Set([...[bg, pop, omni, bridge].join("\n")
  .matchAll(/sendMessage\(\s*\{\s*type:\s*"([a-z-]+)"/g)].map((m) => m[1]));
const recus = new Set([...bg.matchAll(/msg\.type === "([a-z-]+)"/g)].map((m) => m[1]));
const orphelins = [...envoyes].filter((t) => !recus.has(t));
ok(`${envoyes.size} types de messages, tous reçus`, orphelins.length === 0, orphelins.join(", "));

// Un el("x") sans id correspondant, et le popup casse à l'ouverture.
const ids = new Set([...popHtml.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]));
const manquants = [...new Set([...pop.matchAll(/el\("([a-z-]+)"\)/g)].map((m) => m[1]))]
  .filter((i) => !ids.has(i));
ok(`${ids.size} champs du popup, tous présents`, manquants.length === 0, manquants.join(", "));

// L'URL du compte vit dans config.js — une copie de public/config.js, que
// ext:zip rafraîchit. Une copie qui dérive enverrait la collecte ailleurs.
const conf = lire("config.js");
ok("config.js est la copie exacte de public/config.js",
  conf === readFileSync(join(ICI, "..", "public", "config.js"), "utf8"),
  "cp public/config.js extension/config.js");

// Le manifeste doit permettre d'atteindre le compte, sinon la poussée échoue
// en silence sur un mur CORS.
const sbUrl = /supabaseUrl: "([^"]+)"/.exec(conf)?.[1] ?? "";
ok("le compte est joignable depuis le manifeste",
  manifest.host_permissions.some((h) => sbUrl && h.startsWith(sbUrl)),
  `${sbUrl} absent de host_permissions`);

// Les fichiers déclarés existent tous.
const declares = [...new Set([
  manifest.background.service_worker,
  manifest.action.default_popup,
  ...manifest.content_scripts.flatMap((c) => c.js),
  ...Object.values(manifest.icons),
])];
const absents = declares.filter((f) => { try { lire(f); return false; } catch { return true; } });
ok(`${declares.length} fichiers déclarés, tous présents`, absents.length === 0, absents.join(", "));

console.log(echecs ? `\n${echecs} échec(s).\n` : "\nTout est vert.\n");
process.exit(echecs ? 1 : 0);
