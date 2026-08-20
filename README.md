# Agenda Cégep

Ton horaire, tes travaux, tes examens et tes MIO d'Omnivox (Cégep de
Trois-Rivières), collectés **chez toi** et affichés dans un tableau de bord
clair. Compte à rebours d'urgence sur chaque échéance, résumés de MIO,
pastilles sur les dates d'examen.

**Installation (macOS)** — une commande dans le Terminal :

```bash
curl -fsSL https://agenda-five-sigma.vercel.app/install.sh | bash
```

Guide illustré et détaillé : https://agenda-five-sigma.vercel.app/guide.html

## Modèle de sécurité

- **Tes identifiants Omnivox ne quittent jamais ta machine.** Ils vivent dans
  un fichier `.env` local, exclu de git, lu uniquement par le navigateur
  Playwright qui tourne chez toi.
- **L'authentification multifacteur n'est jamais contournée.** C'est toi qui
  saisis le code ; le script attend. Aucune tentative de connexion automatique
  n'est possible depuis la collecte planifiée (`allowLogin:false`).
- **Une seule tentative de connexion, jamais de réessai** — des échecs répétés
  arment le captcha d'Omnivox puis verrouillent le dossier.
- Le compte nuagique (facultatif) ne transporte que les **données dérivées** —
  échéances, résumés, et la liste de ce que tu as supprimé — sous ton propre
  compte, protégé par RLS. Cette dernière est ce qui empêche la collecte
  suivante de te remettre une tâche ou une échéance que tu viens de retirer :
  Omnivox, lui, continue de l'afficher.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run login` | Établit la session (fenêtre visible, code MFA saisi par toi) |
| `npm run scrape` | Une collecte : évènements Léa + MIO, résumés, poussée nuagique |
| `npm run horaire <image>` | Lit une capture/photo de ton horaire (heures visibles) et remplit la grille |
| `npm run check` | La session tient-elle encore, et depuis quand |
| `npm run discover` | Relève la navigation réelle du portail (débogage) |

La collecte automatique passe toutes les heures via `launchd`
(`horaire.scrape.plist`). Journal : `data/scrape.log`.

## Quand la session Omnivox expire

Omnivox ferme la session au bout de quelques jours. La collecte planifiée
**ne se reconnecte jamais seule** : elle s'arrête sur `Aucune session valide`
puis `ARRÊT DÉFINITIF`, et sort en code 3. C'est le comportement voulu — une
tâche de fond qui réessaie une connexion arme le captcha, puis verrouille le
DA.

**Tu es prévenu sans rien surveiller** : au premier passage manqué, la collecte
poste une notification macOS avec la commande à taper. Elle ne revient ensuite
qu'une fois toutes les 6 h tant que la panne dure, et une dernière annonce le
rétablissement. L'état complet est dans `data/health.json` (`kind: "session"`
= il faut refaire le login).

Rien n'est à réinstaller : ni les dépendances, ni Chromium, ni la tâche
`launchd`. Seule la session a expiré.

```bash
cd ~/AgendaCegep      # ou le dossier du dépôt
npm run check         # « session réutilisée » = rien à faire
npm run login         # fenêtre visible, tu saisis le code MFA
npm run scrape        # rattrape la collecte manquée sans attendre l'heure
```

La tâche horaire reprend d'elle-même au passage suivant. Pour la forcer, ou
vérifier qu'elle est toujours chargée :

```bash
launchctl print gui/$(id -u)/ca.qc.cegeptr.agenda.scrape
launchctl kickstart -k gui/$(id -u)/ca.qc.cegeptr.agenda.scrape
```

Si le login résiste : `npm run login -- --manuel` (tout est tapé à la main dans
la fenêtre). **Une seule tentative à la fois** — jamais deux `login` de suite.

Version illustrée : https://agenda-five-sigma.vercel.app/guide.html#reconnexion

## Rappels, une heure avant

Le haut du tableau de bord porte deux cartes : **« Ça s'en vient »**, le
prochain cours, bloc ou remise avec son compte à rebours, et **« Dates
importantes »**, les examens et les remises rangés par date.

Le bouton **Rappels** de la première carte demande l'autorisation au
navigateur, puis annonce chaque cours, chaque bloc ajouté à la main et chaque
remise **une heure avant**. Une échéance sans heure est annoncée le matin même,
à 8 h — « dans 1 h » n'aurait rien à quoi se rattacher.

Ce rappel part de l'app, pas d'un serveur : **elle doit tourner**, une fenêtre
en arrière-plan suffit (l'app installée sur le Dock fait très bien l'affaire).
Rien n'est envoyé nulle part, et la liste de ce qui a déjà sonné reste dans le
navigateur. Au retour d'un onglet endormi, ce qui aurait dû sonner pendant la
veille est rattrapé — sauf ce qui a déjà commencé, qu'annoncer après coup ne
servirait à rien.

L'alerte de collecte arrêtée, elle, est une notification macOS envoyée par la
tâche planifiée : les deux ne se marchent pas dessus.

## Personnaliser

L'horaire de la session est saisi dans `agenda.html` (constante `TT`) : adapte
les cours, la date de rentrée (`SEMESTER_START`) et le nom affiché. Les
résumés de MIO utilisent `claude-haiku-4-5` si `ANTHROPIC_API_KEY` est définie
— seuls les **nouveaux** messages sont envoyés à l'API.

## Ce que ce projet refuse de faire

Centraliser des identifiants Omnivox, contourner la MFA, ou réessayer une
connexion échouée. Ce n'est pas de la prudence décorative : c'est ce qui
protège ton dossier étudiant.
