# Refonte UX — diagnostic, structure, système

Document de travail. La maquette cliquable qui l'accompagne vit hors dépôt
(scratchpad de session) ; ce fichier retient les décisions, pas le code.

---

## 1. Ce qui ne va pas, mesuré

| Mesure | Aujourd'hui | Après |
|---|---|---|
| Hauteur du tableau de bord (bureau, 720 px) | **4,8 écrans** (3 451 px) | **1,35 écran** (970 px) |
| Hauteur sur mobile (375 × 812) | **8,4 écrans** (6 820 px) | **1,88 écran** |
| Cartes visibles simultanément | **11** | **3** |
| Éléments cliquables sur le tableau | **76** | 22 |
| Entrées de navigation | **12** (dont 9 matières) | **7 + 2 réglages** |
| Défilement avant de voir « Ça s'en vient » sur mobile | **~1,5 écran** | **0** |

### Le défaut de structure

`goto()` dans `agenda.html` fait un `scrollIntoView`. **La barre latérale n'est
pas une navigation — c'est une table des matières.** Cliquer « Échéances » ne
mène nulle part : la carte était déjà à l'écran. Conséquences :

- aucun sentiment de lieu — on ne sait jamais « où » on est ;
- aucune adresse — impossible de revenir, de partager, d'ouvrir en signet ;
- le bouton « retour » du navigateur quitte l'app ;
- le tableau de bord ne peut pas être épuré, puisqu'il **contient** l'app entière.

Tout le reste découle de ça.

### La redondance

Le même chiffre, répété jusqu'à quatre fois :

| Donnée | Apparaît dans |
|---|---|
| 31 h de cours | barre latérale · « Aperçu de la session » · légende du graphique |
| Nombre d'échéances | barre latérale · tuile KPI · titre de carte · anneau de progression |
| Nombre de MIO | barre latérale · tuile KPI · titre de carte |
| Nombre de cours | barre latérale · « Aperçu » · légende |

### Les métriques creuses

- **« Progression 31 % global »** mélange « À faire », « Échéances » et
  « Semaine 4/5 j ». Ce dernier terme est *le temps qui passe* : l'anneau
  progresse tout seul du lundi au vendredi, sans qu'on ait rien fait.
  Un chiffre qui monte quand on ne travaille pas ne mesure rien.
- **« Aperçu de la session »** — cinq tuiles qui redisent la barre latérale.
- **Graphique « Cette semaine »** — les heures de cours par jour. L'horaire d'un
  cégépien est fixe ; ce n'est pas une donnée qui varie, c'est une décoration.

### Le mobile est cassé, pas seulement dense

Sous 900 px la barre latérale se replie en **grille bancale de deux colonnes** :
« Tableau de bord | Horaire », « Échéances | MIO », et « Classes » flotte,
centré verticalement, à côté de la liste des matières. Elle occupe 359 px de
large sur 375, et une pleine hauteur d'écran et demie — **avant** le moindre
contenu.

---

## 2. Le comportement réel de l'utilisateur

Un cégépien ouvre son agenda dans trois situations, et une seule domine :

| Moment | Durée | La question |
|---|---|---|
| **Entre deux cours, au téléphone** (le cas dominant) | ~15 s | « Je vais où, et c'est quand ? » |
| Le soir, au portable | ~5 min | « Je travaille sur quoi ce soir ? » |
| Le dimanche | ~15 min | « À quoi ressemble ma semaine ? » |

Le tableau de bord actuel ne sert aucune de ces trois questions : il les sert
toutes mal, en même temps. **Un tableau de bord qui répond à tout ne répond à
rien.**

La refonte fait un choix : le tableau de bord sert le cas de 15 secondes. Les
deux autres ont leurs destinations.

---

## 3. La structure

### Navigation — sept destinations, chacune une vraie vue

```
Aujourd'hui   ← le tableau de bord (renommé : un moment, pas un meuble)
Échéances     ← remises + examens + business, fusionnés
Horaire       ← la grille, seule à l'écran
Mes cours     ← les 9 matières (elles quittent la barre latérale)
Notes
MIO
Classes
─────
Thème · Mon compte
```

Mécanique : `showView()` existe déjà et gère `board / profil / matiere /
landing / onboard / notes`. Il suffit de lui confier aussi `horaire`, `cours`,
`echeances`, `mio` — et d'ajouter le `hash` pour l'adresse et le bouton retour.
**Aucune carte n'est réécrite : elles déménagent.**

Les neuf matières quittent la barre : neuf entrées de plus y doublaient la
navigation et repoussaient « Compte » et « Affichage » hors de l'écran. Elles
vivent dans « Mes cours », là où on va pour les consulter.

### Le tableau de bord — trois zones, un écran

**1 · Le focus** — carte inversée, pleine largeur, courte.
Le compte à rebours, le cours, le lieu, puis le suivant.
*Aujourd'hui ce bloc flotte au milieu d'un vide* : `.r0` est en
`align-items:stretch`, donc « Ça s'en vient » s'étire à la hauteur de
« Dates importantes » et son contenu se centre dans le vide. Ici la carte est
dimensionnée par son contenu.

**2 · Ce qui presse** — une liste, une échelle, un tri.
Remplace « Dates importantes » + « Échéances » + « Examens » — trois cartes qui
montraient des données qui se recouvrent, avec trois tris différents.
Trois paliers de temps, jamais plus fin : *Aujourd'hui et demain · Cette
semaine · Plus tard*.

**3 · À faire** — la seule liste où l'on écrit.

### Ce qui disparaît du tableau de bord

| Élément | Sort |
|---|---|
| Aperçu de la session (5 tuiles KPI) | **supprimé** — redit la barre latérale |
| Progression (anneau 31 %) | **supprimé** — métrique creuse |
| Cette semaine (histogramme) | **supprimé** — l'horaire est fixe ; l'info vit dans Horaire |
| Résumés MIO | → vue **MIO** |
| Examens et business | → fusionnés dans **Échéances** |
| Grille horaire | → vue **Horaire** |
| Mes cours | → vue **Mes cours** |

---

## 4. Le système de composants

Ces primitives existent déjà dans `agenda.html`. Elles ne sont pas inventées —
elles sont **nommées, figées, et réutilisées sans variante locale**.

### Surfaces
| Classe | Rôle | Règle |
|---|---|---|
| `.card` | toute surface de contenu | `border-radius:26px` · `--shadow` · jamais de bordure |
| `.focus` | **une seule par écran** | fond `--invert` ; c'est le point focal, il ne se partage pas |
| `.emptybox` | carte sans contenu | une icône, **un** titre gras, **une** phrase |

### Rythme
Un seul pas d'espacement : `.85rem` entre cartes, `1.25rem` de rembourrage
interne, `26px` de rayon. Aucune valeur ad hoc.

### En-têtes
`.ch` = titre + compteur discret + actions à droite.
Un en-tête de carte ne porte **jamais** plus d'une action.

### Boutons — quatre, pas davantage
| Classe | Emploi |
|---|---|
| `.pill` | action principale, pleine, `--invert` — **une par vue** |
| `.ghost` | action secondaire, fond `--surface-2` |
| `.link` | navigation dans un en-tête (« Tout voir → ») |
| `.nadd` | ajout en place, en pied de liste |

### L'échelle d'urgence — la seule couleur signifiante
```
≤ 1 jour   --p3  rouge     3 jours   --p2  orange
≤ 10 jours --p1  jaune     au-delà   --p0  vert
```
Elle sert **partout** de la même façon : trait de 3 px à gauche de la ligne, et
couleur du délai. Vérifié dans les deux thèmes.

Les **teintes de matière** (`--h`, une teinte HSL par cours) sont une identité,
pas un signal : pastille de 0,45 rem, jamais de fond, jamais de texte coloré.
Deux systèmes de couleur, deux rôles, aucun croisement.

### Densité
Une carte de tableau de bord montre **5 lignes au plus**, puis « Tout voir → ».
Le reste appartient à la destination.

---

## 5. Microcopie

| Aujourd'hui | Proposé | Pourquoi |
|---|---|---|
| « Tableau de bord » | **« Aujourd'hui »** | nomme un moment, pas un meuble |
| « Éteints. Une notification une heure avant chaque cours, bloc ou remise. » | **« Me prévenir »** / **« Prévenu »** | un interrupteur dit son état, pas sa doctrine |
| « Ça s'en vient » | **« Prochain cours »** | dit *quoi*, pas *quand vaguement* |
| « Aucune échéance — Le scraper Léa et MIO les ajoutera tout seul. Une pastille rouge apparaîtra alors sur la date dans l'horaire. » | **« Rien ne presse — Aucune remise ni examen dans les deux prochaines semaines. »** | un vide se constate en une phrase ; il n'explique pas la plomberie |
| « Résumés MIO » | **« MIO »** | le contenu dit déjà que ce sont des résumés |

La voix reste la vôtre : tutoiement, français concret, phrases courtes. On
raccourcit — on ne fade pas.

---

## 6. Transplantation

Ordre conseillé, chaque étape livrable seule :

1. **Le routage.** Étendre `showView()` aux quatre sections restantes + `hash`.
   *Rien ne bouge visuellement ; tout devient adressable.*
2. **Le tableau de bord.** Retirer `#top` (Aperçu, graphique, Progression),
   fusionner `#wdates` + `#echeances` en « Ce qui presse ».
3. **Le focus.** Sortir `.r0` de `align-items:stretch`, passer la carte en
   pleine largeur.
4. **Le mobile.** `.side{display:none}` sous 860 px, barre de cinq onglets.
5. **La barre latérale.** Sortir les matières vers « Mes cours ».

⚠️ `agenda.html` est écrit simultanément par plusieurs sessions. Relire chaque
zone juste avant de l'éditer.
