# Feuille de route — collecte et données

**Cible** (décidée le 2026-08-26) : la collecte doit finir par tourner **même
quand aucun appareil de l'étudiant n'est allumé**, et servir des utilisateurs
qui n'ont pas de Mac — Windows, Chromebook, **iPad**. L'extension Chrome
(étape 1, faite) est le premier pas ET la pièce qui rend la suite possible :
elle deviendra le *relais de session* du serveur.

## ✅ Étape 1 — Extension Chrome (dossier `extension/`)

Collecte passive + active dans la session réelle de l'étudiant ; livraison au
tableau de bord au format `data.json` ; mêmes `id` que le scraper local.
Reste à faire au fil de l'usage : vérifier la stabilité des URL profondes de
MIO d'une session à l'autre, et couvrir la section **Documents** de Léa (les
notes de cours) — page à visiter une fois pour relever sa structure.

## Étape 2 — Moodle par API (côté serveur, aucun appareil requis)

Instance vérifiée le 2026-08-26 : **https://cegeptr.moodle.decclic.qc.ca**
(connexion M365 ou compte local ; services web mobiles actifs —
`/login/token.php` répond).

- Obtenir un jeton : `login/token.php` (si le compte local marche), sinon flux
  SSO mobile (`admin/tool/mobile/launch.php`) — une connexion navigateur, un
  jeton durable ensuite.
- Appels : `core_enrol_get_users_courses`, `core_course_get_contents` (chaque
  fichier avec son `fileurl` **exact** → liens cliquables gratuits),
  `mod_assign_get_assignments`, `core_calendar_get_action_events_by_timesort`.
- Un diff de `core_course_get_contents` entre deux passages = « le prof a
  publié de nouvelles notes ».
- Pas de captcha, jeton durable → **tourne sur Railway**, machines éteintes ou
  pas. C'est aussi la voie des utilisateurs iPad (aucune extension possible
  sur iPad ; leur collecte est serveur ou rien).

## Étape 2b — Relais de session Omnivox (pour la collecte serveur)

L'extension pousse les **cookies de session** (jamais les identifiants) vers
le serveur, chiffrés, sous le compte de l'étudiant ; le serveur collecte
toutes les heures **sans jamais toucher au formulaire de connexion** — le
captcha ne se déclenche qu'au login, pas sur une session valide. Chaque
reconnexion naturelle de l'étudiant re-synchronise la session.

À vérifier avant de s'engager : la session Omnivox est-elle liée à l'IP ?
(Test : relire `/intr/` depuis Railway avec des cookies relevés sur le Mac.)
Si oui, repli : la collecte Omnivox reste sur les appareils (extension), et
seul Moodle est serveur.

## Étape 3 — Modèle « item » unifié

Un seul enregistrement pour tout ce qui est collecté, quelle que soit la
source : `{ source (lea | mio | moodle), cours, genre (message | document |
devoir | examen), titre, resume, url, publie_le, echeance_le, statut (nouveau
| vu | fait), consigne }`. Un adaptateur par source, une table Supabase
`agenda_items` (préfixe `agenda_`, RLS par compte — cohérent avec la vision
classes). Le tableau de bord devient des tris/filtres sur une collection.

## Étape 4 — Consignes de l'agent avec URL exacte

Nouveau type d'action `consulter` dans `src/scrape/agent.ts` (le pipeline de
validation existant l'absorbe) : « va regarder / imprime / complète », dérivé
du corps du message ou de la description Moodle, **avec le lien profond** vers
le message ou le document d'origine. Les corps + liens capturés par
l'extension (`bodies` dans `chrome.storage.local`) sont l'entrée de cette
étape.
