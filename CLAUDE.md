# Agenda Cégep — contexte pour l'agent

PWA d'agenda étudiant (Omnivox + Moodle, cégep de Trois-Rivières), vanilla,
sans framework. Tout est en français : code, commentaires, commits.

## Carte

- `agenda.html` — LA source du tableau de bord (HTML + JS inline). `build.mjs`
  l'emballe en `public/index.html`. Ne jamais éditer `public/index.html`.
- `public/` — ce que Vercel sert : `classes.html`, `sw.js`, `config.js`,
  `install.sh`, guides.
- `src/` — collecteur Node/Playwright (scraping Omnivox), `moodle/`, `push/`,
  `sync/`. Entrée : `src/cli.ts`.
- `extension/` — collecteur Chrome MV3. `parsers.js` est un port MANUEL de
  `src/scrape/` ; la parité est vérifiée par `npm run ext:verifier`.
- `site/` — vitrine Next.js, projet séparé (son propre CLAUDE.md).
- `supabase/` — migrations (tables préfixées `agenda_`, RLS par compte) et
  fonctions edge `agenda-moodle`, `agenda-resume`. Seaux : `agenda-docs`,
  `agenda-classes`.

## Config d'instance — public/config.js

Source unique de l'URL Supabase, de la clé publiable et de la clé VAPID
publique. Trois règles :

1. Toute modif de `config.js` ⇒ **bumper `CACHE` dans `public/sw.js`**
   (le fichier est précaché, sinon l'ancienne config reste servie).
2. `extension/config.js` est une copie : `npm run ext:zip` la rafraîchit,
   `ext:verifier` échoue si elle dérive.
3. `extension/manifest.json` est statique : `host_permissions` répète l'URL
   Supabase, à changer à la main.

Secrets : `.env` seulement (jamais commité). La clé VAPID privée n'existe que
là. Jamais de `service_role` dans le code — clé publiable + RLS, point.

## Commandes

- `npm run typecheck` — avant de conclure toute modif TS.
- `npm run ext:verifier` — après toute modif de l'extension.
- `node build.mjs` — reconstruit `public/index.html`.
- `npm run login` / `scrape` / `check` / `moodle-login` / `moodle` / `push`.
- Déploiement : `npx vercel --prod` — **téléverse l'arbre de travail TEL
  QUEL, commité ou non**. Arbre propre obligatoire.

## Règles intouchables

- **Jamais de réessai de connexion Omnivox.** Des échecs répétés arment le
  captcha puis verrouillent le dossier étudiant. Une tentative, c'est tout ;
  la collecte planifiée ne se reconnecte jamais seule (`allowLogin:false`).
  Ne pas « corriger » ce comportement.
- Le MFA est saisi par l'humain, toujours.
- Les sentinelles `REMPLACE_MOI` du `.env` bloquent volontairement toute
  soumission à Omnivox.

## Pièges connus

- La barre latérale existe en DEUX copies : `agenda.html` et
  `public/classes.html`. Toute entrée ajoutée dans l'une se répercute à la
  main dans l'autre.
- Le service worker sert le cache même si le serveur est mort : vérifier une
  panne par le réseau, pas par la page.
- En local, les pages parlent au VRAI Supabase de l'instance : ne pas tester
  les formulaires de compte sans intercepter `fetch` (voir
  `public/demo-classes.html`, qui rejoue `classes.html` contre un faux
  serveur — c'est l'endroit pour tester l'interface sans risque).
- `data/` contient sessions et jetons : jamais commité, jamais partagé.
