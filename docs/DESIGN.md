# Design « Ordre du jeu »

Référence visuelle du site, validée par Sim le 23/11/2026. **Toute nouvelle page ou modification d'interface suit ce document.**

- Maquettes (une page du canevas par écran, cadres « retenu ») : https://claude.ai/artifact/9U1vyHpgMoBVkPoY53Yksj
- Décisions détaillées écran par écran : document `claude/07-design.md` du Projet claude.ai « Tournoi DCPT ».
- Le test `src/design.test.ts` vérifie automatiquement les règles marquées **(vérifié)** à chaque PR.

## L'idée

Inspiré des tableaux d'ordre de passage des tournois de tennis : la date du jour en très grand, des heures en gros chiffres ocre, des listes nettes séparées par des filets noirs. Fun par l'ocre terre battue et les grands titres, classe par la sobriété (noir, blanc, angles droits). Mobile d'abord : on consulte et on saisit pendant la pause, téléphone en main.

## Couleurs (couleurs FFT, définies dans `src/index.css`)

| Nom Tailwind | Valeur | Usage |
|---|---|---|
| `ochre` | `#C4511E` | Aplats : bande du haut, affiche des fléchettes, ta ligne dans un programme, annonce à la une, onglet actif (souligné) |
| `ochre-text` | `#B4471A` | Texte et liens ocre sur fond blanc (contraste 5,4:1), erreurs |
| `ochre-tint` | `#FFF1E9` | Surlignage léger (ta ligne dans un tableau, notification non lue) |
| `ochre-light` | `#FFB38F` | Ocre lisible sur fond noir |
| `black` | `#000000` | Texte, bouton principal, filets, bloc « Tes matchs », affiche du mini-pong |
| `white` | `#FFFFFF` | Fond de page |
| `mist` | `#F1F1F1` | Zones admin et secondaires (bloc « À régler », sections d'administration) |
| `muted` | `#4D4D4D` | Texte secondaire (dates, aides) |

- Pas d'autre couleur **(vérifié : pas de code couleur `#…` dans les composants)**.
- Les anciens noms (`court`, `clay`, `ball`, `chalk`, `ink`) restent des alias de cette palette pour l'ancien code ; le nouveau code utilise les noms ci-dessus.
- Compteur de fléchettes : fond noir pendant la partie (classe `counter-dark`, qui inverse les couleurs claires).

## Typographies (hébergées avec le site, paquets `@fontsource-variable`)

- **Big Shoulders Display** (`font-display`) : titres de page (56–72 px mobile, jusqu'à 120 px et plus sur ordinateur), titres de section (30–40 px), heures, dates, scores et Elo en grand. Graisses 800–900.
- **Schibsted Grotesk** (police par défaut) : tout le reste. Texte courant 15–17 px, aides 13 px.
- Pas de texte en majuscules **(vérifié : pas de classe `uppercase`)**, pas de petite étiquette au-dessus des titres.
- Heures à la française : « 12 h 45 » (`frenchTime`), dates en toutes lettres : « Lundi 23 novembre ».

## Formes

- **Angles droits partout** (les classes `rounded-*` valent 0) ; seules les pastilles (initiales, compteurs de notifications) sont rondes (`rounded-full`).
- Pas d'ombres : on sépare par des **filets noirs** (1 px entre les lignes, 2–4 px sous les titres de liste) et des **aplats**.
- Champs : bordure noire 2 px, hauteur 52 px, libellé au-dessus (`TextField`).
- Boutons : principal noir plein (`PrimaryButton`), secondaire à bordure noire (`SecondaryButton`), danger à bordure ocre. Survol : ocre foncé.
- Zones cliquables d'au moins 44 px de haut. Focus visible : contour ocre 3 px (global).
- Pas d'émojis dans l'interface **(vérifié)** : icônes SVG au trait de 2 px (`Icon` dans `src/components/ui.tsx`).

## Composants partagés (`src/components/ui.tsx`)

`PageTitle`, `SectionTitle`, `Icon`, `TextField`, `PrimaryButton`, `SecondaryButton`, `Notice` (info : gris ; erreur : ocre ; succès : filet noir), `AuthScreen` (pages d'accès). Les utiliser plutôt que recréer des styles.

## Mise en page

- En-tête : bande ocre de 8 px tout en haut, « MPF » + « Mini-pong et fléchettes », menu souligné en ocre sur ordinateur, cloche des notifications (joueurs), bouton noir « Administration » (admin), pastille d'initiales vers le profil. Spectateurs : « Se connecter pour jouer » et « Quitter ».
- Barre du bas (mobile) : Accueil, Tournois, Compteur, Classement, Profil (sans Profil pour les spectateurs), icônes SVG, onglet actif en ocre.
- Panneaux de saisie (score, horaire, match classé) : panneau qui monte du bas sur mobile, fenêtre centrée sur ordinateur, filet noir en haut.
- Contenu en une colonne sur mobile ; sur ordinateur, grilles à 2–3 colonnes, largeur max 1152 px.

## Écrans (résumé des choix)

| Écran | Choix |
|---|---|
| Entrée | Deux portes : « Jouer » (noir) et « Regarder » (ocre), en grand |
| Accueil | Date du jour en très grand ; bloc noir « Tes matchs » (spectateurs : « Prochain match ») ; programme de la pause avec heures ocre et ta ligne en ocre ; admin : bloc gris « À régler » + raccourcis |
| Tournois | Affiches : tournoi en cours en grand aplat (mini-pong noir, fléchettes ocre) ; terminés en cadres, archivés en pointillés |
| Page d'un tournoi | Bandeau de couleur de la discipline avec le nom en très grand ; onglets soulignés en ocre ; tableau entier à faire glisser sur mobile ; ta case en ocre |
| Fiche match | Score mini-pong en champs chiffrés par set, horaire en boutons, bandeau du temps de correction restant |
| Compteur | Fond noir, tous les scores côte à côte (joueur en cours en ocre), bust en simple bandeau ocre |
| Classement | Ta position d'abord (bloc noir), puis tableau rang / joueur / Elo / % / V–D ; seulement la série (flamme), pas de flèche de progression |
| Profil | Carte de joueur ocre avec le nom en très grand ; réglages derrière l'icône engrenage |
| Annonces | La plus récente à la une (aplat ocre), les autres en cadres ; annonces passées derrière un lien |
| Administration | Outils sur les pages elles-mêmes (onglet Gestion, boutons Modifier) ; page Administration réduite aux comptes, lieux et accès, en zones grises |

## Rédaction

Phrases courtes au tutoiement, verbes d'action sur les boutons (« Saisir le score », « Enregistrer le match »), le même mot du bouton au message de confirmation. Les erreurs disent ce qui ne va pas et comment corriger, sans s'excuser.

## Checklist avant chaque PR qui touche l'interface

1. Les couleurs, polices et composants viennent de ce document.
2. L'écran tient à 320 px de large et sur ordinateur.
3. Contraste suffisant (texte ocre sur blanc : `ochre-text`, pas `ochre`).
4. `npm test` passe (dont `src/design.test.ts`).
5. Un nouvel écran sans maquette : proposer d'abord à Sim une ou plusieurs options dans le canevas, puis coder l'option retenue.
