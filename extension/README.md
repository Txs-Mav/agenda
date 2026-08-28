# Extension Chrome — Collecteur Agenda Cégep

Collecte tes évènements Léa et tes MIO **pendant que tu utilises Omnivox
normalement**, et alimente le tableau de bord. Fini la session Playwright qui
expire : l'extension vit dans TA session, celle que tu rafraîchis de toute
façon en te connectant comme d'habitude.

Elle remplace, pour la plupart des gens, le collecteur local (`npm run
scrape`) : rien à installer en ligne de commande, rien à planifier, et elle
vaut pour **n'importe quel cégep** — l'adresse du portail est relevée sur
place au premier passage, jamais supposée.

## Ce qu'elle fait

- **Collecte passive** : chaque visite sur Omnivox est moissonnée sur place —
  cartes d'évènement de l'accueil, liste des MIO, et **le corps complet d'un
  MIO que tu ouvres, avec ses liens réels et son URL profonde** (ce que le
  scraper Playwright perdait).
- **Collecte active** : toutes les heures tant que Chrome est ouvert, elle
  relit l'accueil et la boîte MIO avec ta session. Si la session est tombée,
  badge « ! » — elle **ne se connecte jamais à ta place** (un login automatisé
  raté arme le captcha d'Omnivox) : tu te reconnectes normalement et la
  collecte repart seule.
- **Vers le tableau de bord ouvert ici** : sur le site de l'agenda (ou
  localhost), les données fraîches sont poussées directement dans la page, au
  même format que `data.json`.
- **Vers ton téléphone** : si tu connectes ton compte d'agenda dans le popup,
  la collecte part aussi vers le compte — donc vers l'app installée sur ton
  téléphone, **sans que le tableau de bord soit ouvert dans ce navigateur**.
  Ce que tu as supprimé à la main est relu avant chaque envoi : une échéance
  retirée ne revient pas, même si Omnivox continue de l'afficher.

Les identifiants (`id`) sont calculés avec les mêmes graines que le scraper
local : les deux collecteurs coexistent sans doublon, et les résumés d'agent
déjà présents survivent. `npm run ext:verifier` le vérifie — c'est le seul
test qui compte vraiment, parce qu'une dérive du hachage ne plante rien : elle
duplique silencieusement.

## Ce qu'elle refuse de faire

Comme le reste du projet : **aucun identifiant Omnivox stocké ou saisi, aucune
connexion automatique, aucun réessai.** `host_permissions` se limite à
`*.omnivox.ca` et au serveur de ton compte d'agenda.

Le mot de passe demandé dans le popup est celui de **ton compte d'agenda** —
jamais celui d'Omnivox. Il sert une fois, à ouvrir une session, et n'est pas
conservé : seul le jeton de rafraîchissement l'est, comme dans n'importe
quelle app. L'extension ouvre sa **propre** session plutôt que d'emprunter
celle du tableau de bord : Supabase fait tourner ce jeton à chaque échange, et
deux détenteurs du même se révoqueraient l'un l'autre — te déconnectant des
deux côtés. Le pont ne relève donc du tableau de bord que le **courriel**, pour
te le proposer au lieu de te le faire retaper.

Sans compte connecté, tout reste dans `chrome.storage.local` de ton
navigateur et rien ne part nulle part.

## Installation

**Pour l'essayer (mode développeur)**

1. Chrome → `chrome://extensions`
2. Activer **Mode développeur** (en haut à droite)
3. **Charger l'extension non empaquetée** → choisir ce dossier `extension/`
4. Visiter Omnivox une fois connecté : la moisson commence toute seule.

**Pour la distribuer**

```bash
npm run ext:zip
```

Vérifie l'extension puis écrit `agenda-collecteur.zip` (le paquet du Chrome
Web Store — sans le vérificateur ni ce README). Il reste à le téléverser sur
le tableau de bord développeur, avec captures et politique de confidentialité.

## Fichiers

| Fichier | Rôle |
|---|---|
| `parsers.js` | Parseurs partagés — ports de `src/scrape/*.ts`, mêmes `id` |
| `omnivox.js` | Content script Omnivox : moisson passive (tous les cadres), relève l'adresse du cégep |
| `background.js` | Service worker : fusion, alarme horaire, santé de session, envoi au compte |
| `offscreen.html/js` | Analyse du HTML relu en arrière-plan (le SW n'a pas de DOM) |
| `bridge.js` | Content script du tableau de bord : livraison des données, indice de courriel |
| `popup.html/js` | État de la collecte, compte, « Collecter maintenant » |
| `verifier.mjs` | Parité des `id` avec le scraper et cohérence de l'extension |
| `banc.mjs` | Banc d'essai du service worker : `chrome` et `fetch` simulés |

`npm run ext:verifier` lance les deux.
