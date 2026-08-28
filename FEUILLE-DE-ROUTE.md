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

## ✅ Étape 2 — Moodle par API (code fait ; reste ton premier `npm run moodle-login`)

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

## ✅ Étape 3 — Modèle « item » unifié (fait le 2026-08-28)

Deux tables et **une règle** : la collecte n'écrit que dans `agenda_items`,
l'étudiant que dans `agenda_item_etat`. Aucune des deux n'écrase l'autre.

| Objet | Rôle |
|---|---|
| `agenda_items` | les FAITS — réécrits à chaque collecte, id stable `source:clé` |
| `agenda_item_etat` | le CALQUE — vu / fait / supprimé / reporté, **sans clé étrangère** vers les items, pour que la pierre tombale survive au retour de l'item |
| `agenda_vue_items` | la COLLECTION — la jointure, en `security_invoker`. Toute l'interface est une requête dessus |
| `src/items/modele.ts` | un adaptateur par source, seul endroit qui connaît la forme d'origine |
| `src/items/pousser.ts` | la poussée, branchée sur `cli.ts` et `moodle/collect.ts` |

C'est ce qui rend `gone`, `mods`, `acted`, `prunGone`, `memeTitre`,
`dupEcheance` et `actionSupprimee` inutiles : sept mécanismes pour une seule
question — « la collecte a-t-elle le droit d'effacer ce que l'étudiant a
fait ? ». Non. Jamais. Ils vivent encore côté client, le temps que le blob
soit retiré ; la base, elle, n'en a plus besoin.

Réserve assumée : l'id Léa reste un hachage de « sigle + titre + date », donc
instable quand le prof déplace une remise. Moodle n'a pas ce défaut. Le
rapprochement des deux se fait à l'ingestion (`fusionne`), pas à l'affichage.

## ✅ Étape 3 bis — Moodle côté serveur (fait le 2026-08-28)

**L'iPad devient un citoyen de première classe.** Fonction edge
`agenda-moodle` : elle lit les jetons avec le rôle de service, appelle Moodle,
écrit les items. Deux entrées, une porte — la clé de service passe tout le
monde (le cron), un jeton d'utilisateur ne passe que lui (« collecter
maintenant »). `verify_jwt` ne suffit pas : la fonction revérifie elle-même,
d'abord.

Le point dur, et sa résolution : le flux mobile de Moodle redirige vers
`moodlemobile://token=…`, un schéma d'URL qu'une PWA iOS **ne peut pas
capter**. Un iPad ne peut donc pas obtenir son jeton seul. Il l'obtient par
`npm run moodle-apparier`, fait une fois depuis n'importe quel ordinateur.
Ensuite l'iPad ne fait plus que lire. Le jeton monte et **ne redescend
jamais** : la colonne est hors de portée en lecture pour `authenticated`.

## ✅ Étape 4 — Une classe ↔ un cours Moodle (fait le 2026-08-28)

`agenda_classes.moodle_course_id` (unique) et `agenda_matieres.moodle_course_id`.
Le gain n'est pas l'appariement mais la **preuve d'appartenance** :
`agenda_join_class_moodle()` n'ouvre la classe qu'à qui est inscrit au cours
selon `agenda_moodle_inscriptions`, relevé par le serveur. Plus de code à six
lettres à faire circuler, et personne d'extérieur ne lit les notes d'une
classe. La vue `agenda_vue_classes_proposees` remplace le champ « code de
classe » vide par ce qu'on peut rejoindre.

Nullable, exprès : un même sigle peut avoir plusieurs groupes. Le code
d'invitation reste la voie des classes non appariées.

## Étape 5 — Consignes de l'agent avec URL exacte


Nouveau type d'action `consulter` dans `src/scrape/agent.ts` (le pipeline de
validation existant l'absorbe) : « va regarder / imprime / complète », dérivé
du corps du message ou de la description Moodle, **avec le lien profond** vers
le message ou le document d'origine. Les corps + liens capturés par
l'extension (`bodies` dans `chrome.storage.local`) sont l'entrée de cette
étape.
