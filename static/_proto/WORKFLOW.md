# Cartes animées depuis les illustrations hero

Les trois POC de référence sont **Ori and the Will of the Wisps**, **Hades** et **Hollow Knight**. Ils conservent les pixels de l’illustration d’origine et composent des calques en WebGL. Ori possède aussi un second artwork, _Vol avec Ku_, qui sert de référence pour une Mythique complète.

Pour produire une carte d’un nouveau jeu, suivre le [workflow générique de création](./WORKFLOW-CREATION.md). Ce document conserve les choix de fabrication propres aux POC et l’état de leur intégration.

## Contrat des éditions

| Édition      | Illustration                                               | Rendu de l’illustration                                                                                                          | Présentation                                                                                 |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Relief**   | Artwork de base                                            | Parallaxe au pointeur uniquement, niveau 2                                                                                       | Cadre du jeu au niveau Relief et bref reflet métallique à la révélation.                     |
| **Vivante**  | Même artwork de base                                       | Animation complète, niveau 3 : personnages, décor, lumière et effets selon la scène                                              | Réveil des couleurs et cadre intermédiaire.                                                  |
| **Mythique** | **Autre artwork du même jeu**, identifiable sans animation | Animation complète, niveau 3 : davantage de détails, un geste ou mouvement de personnage distinctif, VFX à plusieurs profondeurs | Révélation gauche → droite → centre, puis cadre complet qui se déploie sur la carte entière. |

Le niveau 3 décrit le comportement du moteur, pas la rareté. Vivante et Mythique utilisent toutes deux ce niveau ; leur différence vient du choix de l’illustration, des calques et de la mise en scène. Les cadres et les effets du booster sont des couches de présentation séparées de l’illustration. Ils ne changent pas la règle « parallaxe seule » de Relief.

## État des POC

| Jeu               | Rendu de référence                                                                  | Cadres et artwork Mythique                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ori**           | `ori/` pour l’artwork de base, `ori-mythique/` pour le vol de Ku                    | Trois niveaux du cadre **Fantasy végétale**. Artwork Mythique distinct.                                                                               |
| **Hades**         | `hades/` pour l’artwork de base, `hades-mythique/` pour Zagreus à l’épée            | Trois niveaux du cadre **Mythologie infernale**. Artwork Mythique distinct. Le visuel WebGL de base présente encore des zones noires héritées du POC. |
| **Hollow Knight** | `hollow-knight-mythique/` pour Relief et Vivante, `hollow-knight/` pour la Mythique | Cadre standard. Le visuel bleu correspond au hero Steam référencé ci-dessous. Les noms de dossier sont historiques.                                   |

## Dimensions

| Élément        | Dimensions                                                      | Usage                                                                                                                                    |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | Résolution originale, par exemple 1920 × 620 pour un hero Steam | Garder les pixels disponibles autour du sujet pour le cadrage et la parallaxe.                                                           |
| Illustration   | Ratio **460:215** (92:43), repère **920 × 430 px**              | Visuel de jeu, calques de la carte et bannière animée. Pour les gros plans, préférer un export **1840 × 860 px** si la source le permet. |
| Carte habillée | Ratio **920:600**                                               | Format du cadre dans le booster et l’inspection. Le cadre et le titre sont ajoutés par l’interface.                                      |

Recadrer l’illustration au ratio 460:215 sans l’étirer. Garder les visages et les détails essentiels dans la fenêtre, puis vérifier ce que masquent le cadre et la plaque du titre. Une fois le cadrage choisi, exporter tous les calques avec le même repère. Si un shader travaille sur une texture source plus large, consigner l’origine et la taille de la fenêtre utilisée.

Pour la bannière, l’avatar et le pseudo sont à gauche. **Sujet centré ou à droite : on garde l’image telle quelle. Sujet à gauche : on inverse la carte.** Ne pas prolonger ni décaler l’image pour déplacer un sujet centré. Le miroir se fait sur toute la scène, effets directionnels et image fixe compris. Vérifier la composition dans l’aperçu de profil, y compris en petit format. Les plans de révélation gardent leur ordre gauche, droite, centre.

## Préparation d’une carte

1. Partir du visuel hero utilisé par le site. `src/lib/art.ts` retrouve les images Steam `library_hero.jpg`. Conserver l’image source et noter son URL.
2. Préparer le cadrage au ratio de l’illustration. Hollow Knight prend une fenêtre de 1326 × 620 px qui débute à (297, 0) dans son hero de 1920 × 620 px. Ses shaders utilisent ce repère et cette origine.
3. Détourer les éléments qui doivent bouger indépendamment. Les masques guidés conservent les couleurs et les traits originaux. Prévoir des recouvrements aux articulations.
4. Reconstituer le décor caché derrière le personnage. LaMa est utilisé pour cette étape. Élargir le masque d’effacement pour supprimer les restes de contours. Inspecter le décor à part et pendant les mouvements de caméra.
5. Inspecter les couleurs des bords transparents sur le décor final. Régler les masques et leur léger antialiasing selon la taille d’affichage.

### Hades

- Source de référence conservée dans `hades/full.jpg`.
- Calques principaux dans `fg.png`, `zagreus-body.png` et `zagreus-sword.png`. La main et l’épée sont dans le même calque articulé.
- Décor dans `bg.jpg`, profondeur dans `bg-depth.png`.
- Les coordonnées artistiques des yeux et de l’arme sont exprimées dans le repère de 920 × 430.

### Hollow Knight

- La source sombre dans `hollow-knight/source.jpg` vient de l’ancienne URL Steam `https://cdn.akamai.steamstatic.com/steam/apps/367520/library_hero.jpg` et sert d’artwork alternatif Mythique. Le [hero Steam bleu](https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/367520/0daf3933d392d7bb7c5a890917e20c917fcc458e/library_hero.jpg?t=1776125684) correspond à l’illustration animée pour Relief et Vivante. La source de travail est une version plus haute de cette composition, qui garde les cornes et le socle dans le cadrage.
- `prepare-layers.py` contient les contours guidés et prépare cinq calques issus des pixels originaux. GrabCut affine la cape, les jambes et le premier plan.
- `prepare-background.py` applique LaMa au masque du personnage pour préparer `bg.jpg`.
- Ces scripts ont été exécutés sur Basic-Desktop avec `C:\AI\see-through\.venv\Scripts\python.exe`. Ce Python contient Pillow, NumPy, OpenCV et PyTorch. Le script LaMa importe le module de `C:\AI\see-through`.
- `prepare-depth.mjs` sépare les plans du décor sans Python, dans Chromium via le Playwright du dépôt : `node static/_proto/hollow-knight/prepare-depth.mjs`. Il détoure les épines noires du premier plan dans `thorns.png`, remplit le décor caché derrière elles et adoucit les stries verticales de LaMa dans `bg-far.jpg`, puis dérive `bg-depth.png` de la luminance (les plans lointains sont plus clairs).
- La caméra applique à chaque plan une profondeur : fond lumineux 0, créatures jusqu’à 0,3, personnage 0,55, épines 1,9. Le décalage vaut `(profondeur − point fixe) × caméra`. Horizontalement, le point fixe (0,12) est placé dans le décor : le fond bouge très peu et les plans proches traversent le cadre. Le zoom de base reste ainsi à ×1,045, juste la marge que parcourt le décor. Verticalement, le point fixe (0,5) est sur le personnage, qui reste presque immobile pour ne pas couper les cornes ; le fond et les épines partent en sens opposés. Le décor est agrandi de 3 % depuis le bas du cadre pour gagner la marge verticale en haut, le socle restant aligné. Un léger travelling avant agrandit davantage les plans proches. Les épines se balancent autour de leur base.
- L’épine de droite est coupée par le bord du cadre. Son recul vers la gauche est limité et le reste du décalage devient un grossissement depuis le coin inférieur droit, sinon l’extension du bord de texture forme une bande horizontale.
- Les tentacules du décor ondulent par une déformation de l’échantillonnage du fond : une onde part de la racine de chaque membre (coin haut droit, bord gauche, coin haut gauche) et grandit vers les pointes. Les épines du premier plan utilisent la même onde, ancrée à leur base, en plus de leur balancement.
- L’aiguillon fait un geste toutes les 8,8 s : la pointe se lève et s’éclaire, frappe, puis rebondit en s’amortissant pendant que l’éclat parcourt la lame. Hors du geste, il suit la respiration. Le pointeur déplace un reflet le long du fil. Près du bord de la lame, les pixels proches du décor reconstruit sont effacés, pour retirer ce qui reste du décor d’origine dans le contour polygonal.
- Petits détails de vie : reflet du masque et lueur au fond des yeux qui suivent le pointeur, pulsation des deux lucioles peintes dans le décor, poussières qui dérivent avec les rafales de la cape. Des rayons de lumière, deux couches de brume, des poussières proches et lointaines et une vignette complètent la profondeur.
- Les calques sont dessinés dans l’ordre jambes, aiguillon, masque, cape et socle. Le masque tourne autour du col. La déformation du tissu augmente vers les pans libres. Les pieds et le socle partagent le même déplacement de parallaxe.

### Ori and the Will of the Wisps

- Source Steam dans `ori/source.jpg`, téléchargée depuis `https://cdn.akamai.steamstatic.com/steam/apps/1057090/library_hero.jpg`.
- `prepare-layers.mjs` prépare tout sans Python, dans Chromium via le Playwright du dépôt : `node static/_proto/ori/prepare-layers.mjs`. Il contient les contours guidés d’Ori, de Ku, de la branche, des pousses et des plantes du premier plan.
- Le détourage remplace GrabCut par un modèle de couleurs : dans une bande autour du contour guidé, chaque pixel est attribué au personnage ou au décor selon les couleurs les plus proches (k-moyennes de chaque côté). Les pousses, trop fines, gardent leur polygone. `masks.png` superpose les masques pour les inspecter.
- Le décor caché est rempli par diffusion pyramidale à la place de LaMa. Ça suffit derrière la branche, où il devient une brume. Derrière les personnages, la zone floue n’apparaît qu’en bordure pendant les mouvements, et la lueur d’Ori la recouvre. Le calque de Ku est aussi complété sous l’oreille d’Ori pour que l’oreille puisse bouger.
- Les calques gardent toute la largeur du hero (1920 × 620). La carte en montre la fenêtre `(400, 0, 1326, 620)`, et la caméra dispose de vraie image sur les côtés au lieu de bords à masquer. Seul le mouvement vertical demande un léger zoom (×1,05).
- `depth.png` porte trois informations : profondeur du décor peinte par grandes zones (rouge), racines lumineuses pour les impulsions de lumière (vert), zone adoucie des racines pour leur ondulation (bleu). L’ondulation doit suivre une zone adoucie : un masque net déchire le dessin.
- La branche se prolonge sous les plantes du premier plan, sinon sa coupe apparaît quand les deux plans se séparent.
- Animations : Ku respire, tourne la tête par à-coups, cligne de l’œil (paupière de la couleur du disque facial) et ses plumes de tête frémissent. Ori respire, lève la tête vers le pointeur, ses oreilles et sa queue flottent, et sa lueur éclaire le flanc de Ku et la branche. Les pousses se balancent, les racines ondulent et des impulsions de lumière les descendent, l’orbe derrière l’arbre pulse, la neige tombe et les braises montent.
- Ori cligne des yeux toutes les 5,3 s, deux fois de suite un cycle sur trois. La paupière prend la couleur de sa peau et suit l’inclinaison de l’œil. Le petit point sombre à droite de l’œil est son nez : il ne cligne pas.
- Par moments, une onde de lumière plus intense descend le long des lianes. Le départ de chaque onde dépend d’un bruit doux en x, pour que les lianes voisines s’allument à des instants différents sans coupure nette.
- L’orbe entre les deux arbres est le cœur d’un vortex léger : le décor proche se tord autour de lui avec une torsion qui respire, des traînées de vent en spirale tournent et s’y enroulent, et des poussières dorées y sont aspirées.

### Ori Mythique · Vol avec Ku

- Source fournie pour l’essai dans `ori-mythique/source.png` (3840 × 2160 px).
- Fenêtre de 3680 × 1720 px à (80, 360), exportée en 1840 × 860 px. Le rendu WebGL et le repli fixe `ori-mythique/full.jpg` sont retournés horizontalement pour placer Ori et Ku à droite. Les calques de travail gardent le repère de la source.
- Relancer les exports avec `node static/_proto/ori-mythique/prepare-art.mjs`. Le script affine le contour guidé par luminance, isole la tête visible d’Ori dans `ori.png` et prolonge les plumes cachées dans `ku.png` par diffusion pyramidale. Pour `bg.jpg`, un masque plus large efface la silhouette et le ciel intact de chaque côté sert à prolonger la brume. Les exports partagent le repère 1840 × 860.
- `cards.js` compose les trois plans en WebGL. La caméra différencie le ciel et le relief proche. L’aile de Ku se déforme progressivement depuis l’épaule, comme le tissu de Hollow Knight ; Ori suit le mouvement du corps avec un léger retard. Les poussières et la lumière d’Ori jouent sur des cycles distincts. `edition.json` règle les trois travellings du booster.
- Le vent traverse le fond et le premier plan. Les feuilles tourbillonnent à deux profondeurs, et les rafales influencent l’aile de Ku. Trois rochers dérivent indépendamment dans le ciel. Le miroir est appliqué au rendu complet, vent et feuilles compris, et le pointeur reste cohérent avec cette orientation.
- Comparer les trois éditions dans le scénario « Ori : Relief, Vivante et Mythique » de `/dev/boosters`. `full.jpg` sert de repli fixe pendant le chargement et lorsque la réduction des animations est activée.

### Hades Mythique · Zagreus à l’épée

- Source fournie dans `hades-mythique/source.webp` (1920 × 1079 px) : Zagreus, l’épée sur l’épaule, devant les spectres de Cerbère et d’Hadès.
- Zagreus est centré dans la source : l’image garde son orientation, sans miroir. La fenêtre de 1920 × 897 px à (0, 60) est exportée en 1840 × 860. Les calques couvrent toute la source réduite au même facteur (1840 × 1034), la fenêtre commence à (0 ; 57,5). Sans marge horizontale dans la source, le léger zoom du shader (×1,035) couvre la parallaxe.
- Relancer les exports avec `~/.venvs/cards/Scripts/python.exe -I static/_proto/hades-mythique/prepare-art.py` (Python 3.12 avec rembg, simple-lama-inpainting, OpenCV ; lancer depuis un dossier sans répertoire `coverage/`, qui masque un module Python). BiRefNet (`birefnet-general`) détoure Zagreus et l’épée d’un bloc ; isnet-anime bavait sur le fond. Les feuilles de laurier qui flottent au-dessus des cheveux sont isolées par écart de couleur au fond lissé dans `leaves.png`. LaMa reconstitue le décor, spectres compris, derrière un masque élargi de 12 px.
- **Zagreus est une marionnette maillée.** Après `prepare-art.py`, exécuter `~/.venvs/cards/Scripts/python.exe -I static/_proto/hades-mythique/prepare-puppet.py`. Les découpes de travail du bras, du corps, de la tête et du poing se recomposent en un seul maillage continu dans `puppet-body.png`. Le script prolonge le raccord biceps–pectoraux sous la garde et recale le fil de la lame reconstituée sur la partie visible. Le dessin se fait dans l’ordre lame derrière, personnage, garde devant.
- Le squelette de `puppet.json` reprend les pivots du torse, de la tête, du bras, du coude, du poignet et de la poignée. Les jambes et le bassin restent la racine fixe. Les trois textures de poids `puppet-weights-*.png` sont **en RGB opaque**. Un ancien poids dans le canal alpha faisait perdre d’autres canaux à la lecture via Canvas 2D. La paume et l’épée suivent le même pivot de prise par la hiérarchie d’os ; l’épée et la garde restent rigides.
- `cards.js` triangule le corps et répartit ses quatre influences principales par sommet, avec un passage progressif entre le torse, l’épaule, le coude et la main. JavaScript calcule les transformations des os. Le vertex shader applique les poids et déforme les sommets. Les passes composent d’abord le décor et les spectres, puis la marionnette et enfin le laurier flottant, les effets proches, l’œil et la vignette.
- Toutes les 7,6 s, le bras amorce la levée de garde. L’épaule tourne d’environ 18°, le coude se replie et le poignet compense pour garder la lame en main. Un éclat court jusqu’à la pointe. En niveau 3, la tête suit légèrement le pointeur et l’autre bras se balance le long de la hanche. Les yeux des spectres s’allument et les feuilles du laurier suivent le mouvement.
- `work/layers-check.jpg`, `work/body-only.jpg` et `work/weights.jpg` (poids colorés par os) servent de contrôle et ne sont pas servis.
- Les spectres sont animés par des rotations ancrées dans le décor, dont l’influence s’efface vers le bord de chaque zone : les oreilles de Cerbère frémissent à des rythmes distincts, sa gueule halète et s’ouvre davantage pendant le geste, sa langue suit avec retard. Hadès incline la tête, son laurier frémit et sa main baguée lisse sa barbe. Les amplitudes restent faibles, car l’étirement des pixels se verrait au-delà de quelques degrés. Les lueurs des yeux des spectres sont calculées dans ce repère déformé (`far`), pour suivre la respiration, l’inclinaison de la tête et la parallaxe ; une lueur posée en coordonnées d’écran resterait en place pendant que le visage bouge.
- Une petite étoile à quatre branches, avec des branches diagonales plus courtes, s’allume dans l’œil rouge de Zagreus toutes les 5,3 s et à l’apogée du geste, comme un reflet de lumière.
- Comparer dans le scénario « Hades : Relief, Vivante et Mythique » de `/dev/boosters`.

## Cadres, retournement et présentation

- Les thèmes sont attribués explicitement dans `src/lib/card-frame.ts` par dossier d’assets. `ThemedCardFrame.svelte` monte le dessin adapté. Sans thème attribué, la carte garde le cadre standard.
- Le cadre vectoriel partage l’inclinaison de la carte mais se place hors du recto recadré, pour laisser les ornements dépasser. Il se déploie au survol dans l’inspection et automatiquement à la fin d’une révélation Mythique. Le verso reste indépendant.
- **Fantasy végétale** : filet d’acier en Relief ; anneau, coins et pousses turquoise en Vivante ; double anneau, cristaux, lianes et particules en Mythique. Le cartouche et la frise sous l’image reprennent le motif ; les feuilles se déploient progressivement.
- **Mythologie infernale** : bronze et frise grecque en Relief ; coins sculptés et fissures en Vivante ; couronne d’obsidienne, ornements latéraux et braises en Mythique. La frise entre le titre et l’image s’illumine depuis la braise centrale sur les niveaux supérieurs.
- Pendant le retournement, le recto montre son image fixe. Les cartes de la grille démarrent le WebGL après la rotation, et après la série en mode « Tout retourner ». Le bouton de carte reste opaque même lorsqu’il est désactivé pendant cette transition, afin de préserver le recto-verso 3D.
- Pour une Mythique, les plans restent **gauche → droite → centre** après un miroir. À la fin, le cadre se déploie sur l’image entière et opaque. Flash, rayons et particules de l’explosion restent derrière la carte. « Tout retourner » raccourcit l’enchaînement, les indices et les trois plans, en gardant leur ordre ; le rythme manuel reste indépendant.
- La bannière réutilise l’illustration panoramique animée. Dans le parcours réel, elle s’équipe depuis la collection ou l’inspection d’un tirage si la carte est possédée et si le jeu est terminé à 100 % sur une version publique éligible. Le profil public permet d’inspecter la carte et son verso. Vérifier aussi le rendu fixe et la position du sujet à droite.

## Animation et effets

- Utiliser une rotation rigide pour un visage ou une arme. La cape et les tissus peuvent utiliser un maillage avec une influence progressive vers les extrémités.
- Ancrer les mouvements aux points de contact. Régler séparément la respiration, le retard de la tête et les mouvements secondaires.
- Garder une marge de cadrage pour les mouvements. Vérifier les extrêmes de la souris, les pointes des accessoires et les bords du décor.
- Pour les yeux de Zagreus, la paupière supérieure descend. Sa couleur est échantillonnée sur la peau puis ombrée. La lueur rouge s’atténue pendant le clignement.
- Un reflet dessiné dans l’illustration devient un effet temporaire. Nettoyer sa zone de repos, puis animer son déplacement, son expansion, sa rotation et sa décroissance.
- Espacer les VFX qui attirent l’attention. Hades utilise un éclat d’épée pendant la levée de garde et une lueur rouge plus intense toutes les 9,7 secondes.
- Adapter les détails au personnage. Hollow Knight utilise un mouvement du masque, du tissu, des poussières lumineuses et un reflet sur l’aiguillon.
- Prévoir une pause et respecter la préférence système de réduction des animations.

## Enseignements des essais

Qwen-Image-Layered a séparé surtout les accessoires et les reflets de Zagreus. See-through a obtenu 21 calques plus détaillés, avec des erreurs sur le bandeau, le vêtement et la garde de l’épée. Le prototype retenu utilise les calques guidés du dessin original.

Le visage reconstruit de Zagreus a été rejeté. Préserver l’illustration originale pour les parties visibles et inspecter toute reconstruction avant de la retenir.

## Vérification

Ouvrir le prototype par le serveur de développement. Vérifier le programme WebGL, les images, les transitions des VFX, la fermeture et la réouverture des yeux, les recouvrements des articulations et les mouvements de perspective. Comparer des captures des phases clés en grand. Contrôler le rendu mobile, la pause et la réduction des animations.

Les essais Playwright peuvent substituer temporairement une horloge de test au temps du shader pour examiner les instants précis. Le rendu normal conserve son horloge réelle.

## Pages et niveaux

- `index.html` et les pages historiques des POC comparent l’original (×1), la parallaxe (×2) et l’animation complète (×3). ×1 est un témoin d’atelier, pas une édition à obtenir.
- `src/lib/animated-card.ts` charge `edition.json` puis `cards.js`, et appelle `window.AchieversCards[id].mount(canvas, level)`. Les scripts historiques disposent aussi d’un montage autonome pour leurs pages HTML. Un script neuf peut se limiter à l’API de montage.
- En ×2, couper la dérive autonome de la caméra et tous les mouvements dirigés par le temps. Le pointeur change seulement la perspective entre les plans. En ×3, activer les gestes, les déformations, les lumières et les effets préparés pour l’artwork chargé. L’original fixe doit rester utilisable quand le rendu animé est indisponible.

## Démonstration et partage

L’[Atelier des cartes](https://achievers-atelier-cartes.pastelhen515.chatgpt.site) rassemble le récap du gacha, le booster jouable, les révélations guidées, la galerie, la collection fictive et l’aperçu de bannière. Son code est dans `sites/achievers-atelier/`. `node sites/achievers-atelier/build.mjs` réutilise les composants du projet et copie une liste explicite d’assets dans `dist/`. À l’ajout d’une carte, inscrire ses fichiers de rendu dans cette liste si elle doit paraître dans l’Atelier.

`sites/cartes-animees/build.mjs` assemble la galerie historique des POC dans `sites/cartes-animees/dist`, avec uniquement les fichiers servis. Ce dossier a servi à la publication via un artifact Claude.

La démo individuelle `sites/hades-card-review` conserve son identité Sites propre dans `.openai/hosting.json`.

Le public voit l’original puis la carte ×3 en grand. Les fichiers publiés contiennent uniquement les images, les polices, le HTML et le JavaScript nécessaires à la démonstration. Les scripts de préparation restent dans les prototypes du dépôt.
