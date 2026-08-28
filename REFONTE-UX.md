# Refonte UX — diagnostic, structure, système

Document de travail. La maquette cliquable qui l'accompagne vit hors dépôt
(scratchpad de session) ; ce fichier retient les décisions, pas le code.

---

## 1. Ce qui ne va pas, mesuré

| Mesure | Aujourd'hui | Après |
|---|---|---|
| Hauteur du tableau de bord (bureau, 900 px) | **3,4 écrans** (3 088 px) | **1,0 écran** (900 px) |
| Hauteur sur mobile (375 × 812) | **8,4 écrans** (6 820 px) | **1,88 écran** |
| Cartes visibles simultanément | **11** | **3** |
| Éléments cliquables sur le tableau | **83** | 23 |
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

## 3 bis. « Tout accessible rapidement » — vérifié, pas affirmé

La question mérite une réponse honnête, parce que « rapide » a deux sens qui
se contredisent : **tout visible sans agir** contre **tout atteignable en un
geste**. On ne peut pas maximiser les deux.

### Ce que coûte vraiment la barre latérale actuelle

Elle est déjà à *un clic* de chaque section — il faut le reconnaître. Mais ce
clic déclenche un défilement **animé** de 1 000 à 2 800 px, et surtout :

```
1. clic « Mes cours »        → la barre dit « Mes cours »  ✓
2. je remonte à la main      → la barre dit ENCORE « Mes cours »  ✗
   (alors que le tableau de bord est à l'écran)
3. bouton retour             → QUITTE L'APP
```

Mesuré sur l'app en fonctionnement. **La navigation ment sur l'endroit où tu
es**, il n'y a aucune adresse, et le retour du navigateur sort de l'app. Le
gain de la refonte n'est donc pas le nombre de clics — c'est que le clic
atterrit quelque part, et que l'app le dit.

### Le bilan honnête, question par question

| La question de l'étudiant | Aujourd'hui | Après |
|---|---|---|
| « Je vais où, et c'est quand ? » *(le cas dominant)* | visible, mais après 1,5 écran sur mobile | **pixel 0, aucun défilement** |
| « Qu'est-ce qui presse ? » | 3 cartes, 3 tris différents | **1 liste, 1 échelle** |
| « Mon horaire ? » | 1 clic + défilement animé de 1 569 px | 1 clic, vue dédiée |
| « Mes MIO / mes cours ? » | 1 clic + 1 000 à 2 400 px | 1 clic, vue dédiée |
| « Ce cours précis / cette remise ? » | défilement + balayage visuel | **⌘K + 3 lettres** |

### Ce que la refonte rend plus lent — et pourquoi c'est acceptable

Voir **l'horaire et les échéances en même temps** (la planification du
dimanche) demandait un défilement ; ça demande maintenant un changement de vue.
C'est la seule régression, et elle est largement absorbée : la grille horaire
porte **déjà** les pastilles d'échéance sur les en-têtes de jour
(`deadlinesOn()` dans `buildWeek`). La vue Horaire montre donc la semaine
*avec* ses remises.

### Ce qui manquait, et qui est ajouté : la palette (⌘K)

Une navigation, si propre soit-elle, coûte un clic par palier. Trois lettres
n'en coûtent aucun. La palette cherche **les vues, les 9 cours et les
échéances** dans le même champ, sans accents ni casse (« ecri » trouve
« Écriture », « geo » trouve « géogr. »).

Point important : **une palette qu'on ne devine pas n'existe pas.** Un cégépien
n'est pas un développeur — le raccourci reste donc doublé d'un champ visible
dans l'en-tête (« Chercher un cours, une remise… ⌘K »). Sur mobile, la barre de
cinq onglets joue ce rôle au pouce.

Clavier complet : `↑ ↓` parcourir · `↵` ouvrir · `esc` fermer.

---

## 3 ter. Direction visuelle retenue : Apple, palette maison

La première maquette était juste sur la structure et fade sur l'exécution —
des cartes grises sur fond gris, sans point focal. Direction retenue après
arbitrage : **la rigueur d'Apple, dans la palette maison** (navy + bleu pâle,
dégradés aplatis — la décision enregistrée est conservée, pas écrasée).

Une référence « verre dépoli sur dégradé lavande » avait été envisagée ; elle
contredisait frontalement cette décision et a été écartée.

Ce que « Apple » veut dire, concrètement :

| Principe | Application |
|---|---|
| **La typographie porte la hiérarchie** | le compte à rebours à 4,1 rem, tracking −.05em. C'est la seule chose grosse à l'écran. |
| **Listes groupées, pas cartes multiples** | un conteneur arrondi, des filets fins entre rangées — le geste des Réglages iOS |
| **Filets insérés** | le trait démarre à l'aplomb du texte (2,85 rem), pas bord à bord : l'œil suit une colonne |
| **Déférence** | la barre latérale sélectionnée est une *teinte* navy, pas un aplat. Le contenu reste le sujet. |
| **Couleur = signal seul** | la pastille d'urgence porte la couleur ; le délai reste gris, sauf « demain » |
| **Chevrons** | chaque rangée qui mène quelque part le dit (indicateur de divulgation) |
| **Cercles, pas cases** | les tâches se cochent comme dans Rappels |
| **Fond plat** | les dégradés radiaux du `body` disparaissent. Le vide est une matière. |

Résultat : **1,00 écran** exactement en 1440 × 900, structure inchangée
(7 vues, ⌘K, onglets au pouce sous 900 px).

Piège corrigé : `.t` et `.s` sont des `<span>` — donc `inline` par défaut. Sans
`display:block`, titre et sous-titre coulent sur la même ligne.

---

## 3 quater. « Sombre noir » + densité restaurée (version retenue)

Deux corrections après essai de la version épurée :

**1. Le vide.** Elle tenait sur 1440 × 900 mais ne *grandissait* pas : à
1800 px de large, 40 % de l'écran restait nu. Trois blocs ne remplissent pas un
grand écran.

**2. J'avais coupé trop profond.** Et surtout : la version épurée n'affichait
**nulle part la forme de la semaine ni les prochaines séances**. Pour un
agenda, c'est une omission, pas une épure.

### Les sept blocs, et ce que chacun gagne

| Bloc | Pourquoi il est là |
|---|---|
| **Prochain cours** (héros) | la question de 15 secondes |
| **Cette semaine** | la forme de la semaine : heures par jour + pastilles de remise. *Remplace l'histogramme, qui montrait les heures sans les remises.* |
| **Prochaines séances** | les 5 prochains cours, heure et local. **Manquait totalement.** |
| **À venir** | remises et examens fusionnés, une échelle |
| **À faire** | la seule liste où l'on écrit |
| **MIO récents** | les 3 derniers, pas les 13 |
| **Mes cours** | pastilles colorées, accès direct |

Restent supprimés : **« Aperçu de la session »** (5 tuiles qui redisaient la
barre latérale) et **« Progression »** (l'anneau dont « Semaine 4/5 j »
progressait tout seul avec le temps qui passe). La densité revient par du
contenu utile, pas par des chiffres décoratifs.

### Mesures

| | Version épurée | Version retenue |
|---|---|---|
| Écran rempli à 1800 × 1150 | ~60 % | **91 %** |
| Blocs | 3 | 7 |
| Visible sans défiler (1440 × 900) | tout | **les 5 essentiels** ; MIO et Cours à un petit geste |

Ce dégradé est voulu : l'urgent en haut, le consultatif juste en dessous.

### Le thème « sombre noir »

Quasi-noir mat, conforme à la décision maison — aucun dégradé.

```
fond    #0A0B0D      bloc    #141619      bloc-2  #1A1D21
accent  #8FB4D9      texte   #F2F4F6      atténué #9BA1A9
filet   rgba(255,255,255,.075)
```

Contraste vérifié sur fond de bloc : titres **16,4:1**, texte secondaire
**6,96:1**, délais **6,47:1** — tous au-dessus du seuil AA (4,5:1).
Le thème clair reste disponible ; le noir est le défaut.

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
6. **La palette ⌘K** + son champ visible dans l'en-tête.

Piège rencontré et corrigé dans la maquette — il vaut pour l'app : toute classe
qui pose un `display` (`.emptybox{display:grid}`) **bat `[hidden]`**, et la
carte vide reste visible sous sa propre liste. Une règle globale
`[hidden]{display:none!important}` règle la famille entière. Votre code note
déjà le cas pour `.board`, mais ponctuellement.

⚠️ `agenda.html` est écrit simultanément par plusieurs sessions. Relire chaque
zone juste avant de l'éditer.
