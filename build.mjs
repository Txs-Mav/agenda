/**
 * agenda.html est la source unique (elle sert aussi d'artefact publié, d'où
 * l'absence de <html>/<head>/<body>). Ce script l'emballe en page complète
 * pour Vercel, avec le manifeste PWA qui la rend installable comme app Mac.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("agenda.html", "utf8");
// La frontière head/body est la fin du bloc <style> : title, meta et styles
// partent dans le <head>, le reste dans le <body>. Insensible au renommage
// des conteneurs de mise en page.
const END = "</style>";
const at = src.lastIndexOf(END);
if (at < 0) throw new Error("Aucun bloc <style> dans agenda.html");

const head = src.slice(0, at + END.length).trim();
const body = src.slice(at + END.length).trim();

const page = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="theme-color" content="#1f2123">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Agenda">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link rel="apple-touch-icon" href="/icon-180.png">
${head}
</head>
<body>
${body}
<script>
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
</script>
</body>
</html>
`;

mkdirSync("public", { recursive: true });
writeFileSync("public/index.html", page);
console.log(`public/index.html écrit (${page.length} octets)`);
