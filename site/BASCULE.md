# Bascule vers Next.js — où on en est, et ce qui reste

## L'état actuel

`site/` est une application Next.js **complète mais débranchée**. La production
continue d'être servie exactement comme avant : `vercel.json` à la racine garde
`framework: null`, `buildCommand: node build.mjs`, `outputDirectory: public`.
Rien de ce dossier n'est déployé pour l'instant.

Ce qui est fait :

- la vitrine de `agenda.html` (lignes du `<div id="landing">`) portée en JSX,
  **même markup, même CSS** — un port, pas une réécriture ;
- son CSS extrait par dépendance réelle (1 098 lignes retenues sur 1 833) ;
- les règles sombres reflétées sous `prefers-color-scheme`, donc **sans script
  de thème** : pas de flash blanc, pas de désaccord d'hydratation ;
- la révélation au défilement redevenue une **amélioration** : le contenu est
  visible par défaut, seul ce qui est hors écran s'anime. Sans JavaScript, la
  page reste entièrement lisible — ce qui n'était pas le cas dans
  `agenda.html`, où tout part à `opacity: 0` ;
- les métadonnées : titre descriptif, `description`, Open Graph, `fr_CA`.

## Le piège : les PWA déjà installées

`public/manifest.webmanifest` déclare `start_url: "/"` et `scope: "/"`, et
`public/sw.js` met `"/"` en cache. **Chaque agenda déjà installé sur un
téléphone ou un Mac ouvre `/`.** Le jour où Next.js prend `/` et où l'app passe
sous `/app`, toutes ces installations se retrouvent sur la vitrine.

La bascule doit donc faire les trois gestes ensemble :

1. `manifest.webmanifest` → `start_url: "/app"`, `scope: "/app"` — pour les
   installations **futures** ;
2. sur la vitrine, une redirection en tête de page pour les installations
   **existantes** :
   `if (matchMedia("(display-mode: standalone)").matches || navigator.standalone)
   location.replace("/app")` ;
3. `sw.js` → mettre `/app` en cache au lieu de `/`, et **incrémenter `CACHE`**
   (`agenda-v9` → `v10`) sinon l'ancien cache continue de servir `/`.

Sans le point 2, les installations existantes sont cassées en silence : elles
ouvrent la vitrine et l'utilisateur croit avoir perdu ses données.

## Les étapes de la bascule

1. Attendre que le travail en cours sur `agenda.html` soit posé — la vitrine y
   vit encore, et les deux divergeraient.
2. `build.mjs` écrit vers `site/public/app/index.html` au lieu de `public/`.
3. `vercel.json` : `framework: "nextjs"`, racine du projet → `site/`.
   Le build lance `node ../build.mjs` puis `next build`.
4. Les trois gestes PWA ci-dessus.
5. Supprimer `<div id="landing">` de `agenda.html` — il ne sert plus à rien, et
   c'est 239 lignes de markup et ~1 100 de CSS en moins dans un fichier qui en
   compte déjà 9 000.
6. Les liens `APP`, `GUIDE` et `DEMO` en tête de `app/page.tsx` passent de
   l'URL de production à `/app`, `/guide`, `/classes`.

## Ce qui reste à construire

- `/guide` et `/moodle` — portage de `public/guide.html` et `public/moodle.html` ;
- l'inscription : elle vit aujourd'hui dans `agenda.html` (Supabase Auth). À
  décider — la déplacer ici, ou laisser la vitrine pointer vers l'app ;
- la tarification, si elle arrive ;
- les classes collaboratives, qui sont la vraie raison d'avoir des routes.

## Régénérer la vitrine depuis agenda.html

Tant que la vitrine vit aux deux endroits, `app/vitrine.css` et `app/page.tsx`
sont **générés** — ne pas les retoucher à la main. Les scripts d'extraction
sont dans l'historique de la session ; ils suivent les dépendances réelles
(classes, ids, balises et attributs employés par le markup), reflètent les
règles sombres, et convertissent le markup en JSX.
