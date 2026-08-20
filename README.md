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
  échéances et résumés — sous ton propre compte, protégé par RLS.

## Commandes

| Commande | Rôle |
|---|---|
| `npm run login` | Établit la session (fenêtre visible, code MFA saisi par toi) |
| `npm run scrape` | Une collecte : évènements Léa + MIO, résumés, poussée nuagique |
| `npm run check` | La session tient-elle encore, et depuis quand |
| `npm run discover` | Relève la navigation réelle du portail (débogage) |

La collecte automatique passe toutes les heures via `launchd`
(`horaire.scrape.plist`). Journal : `data/scrape.log`.

## Personnaliser

L'horaire de la session est saisi dans `agenda.html` (constante `TT`) : adapte
les cours, la date de rentrée (`SEMESTER_START`) et le nom affiché. Les
résumés de MIO utilisent `claude-haiku-4-5` si `ANTHROPIC_API_KEY` est définie
— seuls les **nouveaux** messages sont envoyés à l'API.

## Ce que ce projet refuse de faire

Centraliser des identifiants Omnivox, contourner la MFA, ou réessayer une
connexion échouée. Ce n'est pas de la prudence décorative : c'est ce qui
protège ton dossier étudiant.
