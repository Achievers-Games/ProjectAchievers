# Workflow de fabrication des cartes animées

## Procédure pour un nouveau jeu

Relire intégralement ce document avant de toucher à une carte. Quand la demande donne seulement un titre, choisir les sources, préparer et livrer **les trois éditions ensemble**. Prendre le même hero Steam vérifié pour Relief et Vivante et une seconde illustration du jeu pour Mythique. Conserver les URL et le fichier maître de chaque scène. Définir les pièces mobiles et les contacts avant de commencer l’animation.

Valider successivement les calques, le rig sans VFX, la boucle avec VFX, puis la grille, l’inspection et la révélation. Reprendre tout défaut visible avant la livraison. Les tests de navigateur vérifient l’intégration et le mouvement des pixels. L’examen visuel reste nécessaire pour juger les contours, les contacts, le cadrage et la différence artistique entre les éditions.

Une carte se décrit dans `scene.json` pour le moteur commun `static/_proto/shared/card-engine.js` (voir « Moteur commun » plus bas) : chaque pièce avec sa texture, son origine, son pivot, son parent et ses mouvements. Le lecteur accepte `data-card-time` pour arrêter le temps, `data-card-intro-time` pour figer l’intro, `data-card-joint` pour isoler un pivot et `data-card-effects="off"` pour masquer les VFX. Exécuter le contrôle des trois éditions sur le serveur de développement. Exemple pour Portal 2 :

```powershell
rtk proxy node scripts/check-dev-card-set.mjs "Portal 2" portal-2 portal-2-mythique
```

Une illustration fixe donne une scène composée de plans, un personnage qui réagit brièvement, puis revient au repos, et des VFX liés au décor ou au geste. Le geste est choisi d’après les pixels disponibles. Le même processus fonctionne pour un personnage entier, un animal, un portrait ou un fragment de silhouette, avec un geste différent pour chacun. Une image n’établit pas ce que cache une épaule ni ce que montre un visage de profil. Une pose qui dévoile ces zones demande de les peindre, ou de choisir une action qui reste dans le plan de l’image.

### La chaîne de fabrication, de bout en bout

1. **Préparer l'atelier.** `node scripts/new-card.mjs <dossier> <appid Steam>` crée `<dossier>` (Relief et Vivante) et `<dossier>-mythique`, chacun avec `cards.js` (chargeur du moteur commun), `scene.json`, `edition.json` et un dossier `work/`. Le hero Steam est téléchargé en `source.jpg`. L'artwork retenu pour la Mythique s'inscrit dans `src/lib/card-artworks.json`, sous l'identifiant Steam du jeu. La page « Cartes à créer » de la modération montre ensuite les trois cartes de chaque jeu sur une ligne : l'image de départ s'agrandit d'un clic, et une carte faite s'ouvre animée, intro de la Mythique comprise.
2. **Découper et animer.** Le master `.ora`, les sources et les essais restent dans l'atelier ; git les ignore.
3. **Vérifier sur planche.** Avec `npm run dev`, `node scripts/card-sheet.mjs "<jeu>" <Relief|Vivante|Mythique>` assemble des images de la boucle à des instants donnés dans `cards-review/`. `--no-vfx` valide le rig sans effets, `--joint <calque>` isole un pivot, `--intro` fige l'intro de la Mythique et `--times` choisit les instants.
4. **Contrôler.** Lancer `check-dev-card-set.mjs` et les tests du catalogue, puis ouvrir de vrais boosters dans `/moderation/boosters`. Cette page tire dans le catalogue réel avec des éclats illimités, sans rien enregistrer. Elle peut forcer la garantie Mythique et simuler des milliers de boosters pour vérifier les pourcentages.
5. **Publier.** Tant qu'il manque une rareté, inscrire le jeu dans `drafts` de `src/lib/card-catalogue.json` : ses cartes publiées se vérifient animées dans « Cartes à créer », sans entrer dans les boosters. Une retouche après publication demande d'augmenter `version`. Quand les trois raretés sont prêtes, retirer le brouillon et ajouter le jeu à `games`, avec une `version` supérieure. Une autre illustration ou une carte d'événement s'ajoute dans `variants` (`id`, `kind`, `folder`). Lancer ensuite `node scripts/publish-cards.mjs` puis `bash scripts/nas-cards.sh`, et commiter le catalogue.
6. **Sauvegarder les sources.** `bash scripts/nas-card-sources.sh push` copie les fichiers de fabrication ignorés par git vers `cartes-sources` sur le NAS. `pull` les récupère sur un autre poste sans écraser un fichier local plus récent, et `list` montre ce qui est sauvegardé.

**Outils communs de découpe.** `static/_proto/card_kit.py` sert aux `prepare-art.py` du moteur partagé : détourage BiRefNet, couleurs de bord nettoyées du décor, remplissage LaMa gardé dans `work/`, matière prolongée sous un calque voisin (`behind`), rectangle du maillage calculé sur l’alpha, master, `full.jpg` et écart entre la source et la recomposition (`work/gap.png`). `node scripts/card-sheet.mjs --folder <dossier> Vivante` fait la planche d’un dossier avant son entrée au catalogue, et `--look x,y` pose le pointeur dans un coin.

### Barrière de qualité

Le premier lot de 21 cartes passait tous les contrôles chiffrés et restait mauvais : décors salis, visages tordus, ailes écrasées. Un pivot qui répond ou un bord sans vide ne prouvent pas la qualité. Une carte ne se publie qu’après ces cinq examens, dans l’ordre.

1. **Décor seul, en grand.** Ouvrir `bg.jpg` sans aucun calque. Aucune ombre, aucun contour ni reste du sujet ne doit se voir. Le trou couvre le sujet **et** son trait noir, son ombre, sa lueur et ses effets. Choisir le remplissage selon la matière :
   - ciel, brume, eau, aplat : `card.sky` (membrane lisse, avec le grain du décor) ;
   - motif rayé : `card.streak` dans le sens des rayures ;
   - disque, anneau, lune, soleil : `card.around` ;
   - texture organique (roche, neige, forêt) : `card.fill` (LaMa). LaMa étire les bords sombres dans les aplats : ne pas l’y employer.
     `card.check` mesure le raccord et donne le pire endroit. Un écart élevé se regarde ; il est normal seulement sur un vrai bord du décor.
2. **Pièces entières.** Lister ce que l’image montre de chaque sujet, y compris derrière une lumière, une fumée ou un accessoire : l’aile droite du drone d’Apex était cachée par son faisceau. `card.lift` récupère un élément translucide à partir du décor refait, `card.sam` découpe une pièce désignée par quelques points, `card.solve` calcule les couleurs de bord qui redonnent exactement la source. Contrôler un masque SAM avant de l’employer : il laisse parfois un trou dans un visage.
3. **Rigidité.** Déclarer dans `guards` chaque visage, casque, masque, main ou arme d’un calque maillé. Le moteur l’emporte d’un bloc, sans jamais le déformer. Une tête, un bras armé ou une arme qui bougent beaucoup vont sur leur propre calque, avec la matière refaite dessous. Une ondulation de cheveux ou de tissu exclut le visage (`except`) et vit de préférence sur son propre calque. Le test du catalogue refuse plus de 3 % de déformation dans une pièce rigide et 36 % ailleurs. Marquer `soft` une paupière qui se ferme.
4. **Ailes et membres.** Une aile bat par rotation : épaule, puis poignet ou `bend` avec un retard d’un quart de cycle, pendant que le corps réagit à l’opposé. Étirer un sujet en hauteur (`sy`) pour simuler un battement est interdit ; le test le refuse.
5. **Gestes et effets.** Un tir ne déplace que le bras et l’arme, sur leur calque, avec un recul court ; `muzzle` dessine l’éclair, les étincelles et la fumée à la bouche du canon. Jamais de zone de déformation autour d’un impact. Un reflet qui parcourt une lame utilise `streak`.

Regarder ensuite chaque carte **à son geste maximal, en 1 180 px de large, sans effets puis avec**, et zoomer ×2 sur chaque visage, arme et raccord. Une planche de quatre vignettes ne suffit pas.

Autres défauts déjà rencontrés :

- **Réserve de caméra.** Laisser entre la fenêtre et le bord de la source au moins la parallaxe horizontale du fond. `card_kit.py` le refuse sinon.
- **Contacts.** Un personnage et ce qui le porte partagent le même plan.
- **Lueur autour du sujet.** Le décor refait l’efface : la remettre en voile derrière lui avec `card.lift`, sinon l’image saute quand le canvas remplace le poster.
- **Lumière rectangulaire.** Donner à un `mist` un `rect` plus grand que son rayon.
- **Halo d’un objet mobile.** Le placer avec `frame`.
- **Maillages.** Ils se dessinent dans un contexte WebGL unique, partagé par toute la page. Le dessin 2D par triangles laissait des coutures sur les calques translucides.

**Avant l'ouverture.** Tant que `CARDS_OPENED_AT` vaut `null` dans `src/lib/server/cards-launch.ts`, les boosters, la collection et les bannières de cartes n'existent que pour la modération, et aucun éclat n'est crédité. Pour ouvrir, y mettre la date de l'ouverture et déployer. Tout le monde part alors de zéro : l'historique d'avant devient le capital de départ.

**Tirage.** Le tirage est un pur hasard. La rareté de chaque carte suit seulement les pourcentages, puis la carte est tirée à chances égales parmi toutes celles de cette rareté, dans tout le catalogue, y compris les jeux que le joueur ne possède pas. Une même carte peut sortir deux fois dans un booster : le doublon part au recyclage. Chaque variante compte comme une carte de plus de sa rareté. Retirer une variante du catalogue la sort des boosters, et ses propriétaires la gardent. Le 100 % du jeu ne sert qu'à mettre la carte en bannière.

## 1. Cadrer et repérer les contraintes

Identifier d’abord le hero Steam en service et consigner l’URL résolue, les dimensions et la date de récupération. L’URL historique `steam/apps/<id>/library_hero.jpg` peut encore servir une ancienne illustration. Vérifier visuellement la version référencée par Steam avant d’attribuer les éditions. Pour une source de travail plus haute issue de la même composition, noter la différence de cadrage et vérifier qu’elle conserve les détails utiles, comme des cornes ou un socle.

1. Garder la source intacte. Poser la fenêtre d’illustration **460:215** dans le repère source. Prévoir **920 × 430 px** pour l’affichage courant et **1840 × 860 px** lorsque les pixels source le permettent. La carte habillée est au ratio **920:600**. La bannière reprend la fenêtre d’illustration. Conserver les pixels hors fenêtre comme réserve de caméra.
2. Vérifier la carte en grille, en inspection et en bannière mobile. Garder un sujet centré ou à droite dans le sens source. Si le sujet est à gauche, vérifier le miroir avec le texte, les symboles et les accessoires, puis appliquer la même décision à l’image fixe, aux calques, au vent et à la réponse horizontale de la souris. Contrôler aussi le dégagement du pseudo et de l’avatar.
3. Annoter la silhouette, les appuis, les contacts entre pièces, les repères rigides et les zones masquées. Dessiner trois vignettes à la taille réelle de la carte. La première correspond à la source. La deuxième montre la préparation du geste. La troisième montre la pose maximale. Comparer les vignettes sans VFX. Le geste doit se lire par un changement de forme, de position relative ou d’expression.
4. Définir la course maximale du geste et de la caméra ensemble. Si le sujet ou le décor sort de la réserve disponible, réduire la course, prévoir la reconstruction ou modifier le geste avant de mailler.

## 2. Choisir un idle break d’après ce qui est visible

Un idle break est un événement au milieu de l’attente. Un clignement discret ou une respiration en boucle servent au repos. Un regard qui accroche une étincelle, suivi d’un mouvement de tête puis d’un retour, forme un idle break complet.

| Cadrage ou sujet            | Idle break réalisable                                                                                                  | Points à vérifier                                                                                                                                                  |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Humanoïde en pied           | Regard vers un stimulus, inclinaison de tête, léger report de poids et retour                                          | Pieds sur leurs appuis, bras et objets solidaires, silhouette du bassin stable                                                                                     |
| Buste avec accessoire       | Attention vers le côté, tête et ceinture scapulaire suivent, retour progressif                                         | Nuque ancrée, arme rigide liée à la prise, décor derrière l’épaule                                                                                                 |
| Animal, créature ou machine | Oreille qui se tend, serre qui se ferme, antenne qui s’oriente, tête ou masque qui réagit                              | Pivot propre à la morphologie. Un vol depuis une pose fixe peut commencer par un battement partiel et un déplacement vertical                                      |
| Visage en gros plan         | Regard qui se fixe, paupière qui se ferme, sourcil ou menton qui répond                                                | Contour de l’œil, volume du crâne, iris recadré par la paupière. Peindre une paupière fermée si nécessaire                                                         |
| Fragment de silhouette      | Doigts qui se resserrent, plume qui se replie, paupière visible qui se ferme, ou bascule locale si la forme est rigide | Appui conservé au bord du cadre. Si la zone articulée est hors champ, animer la portion visible autour d’un pivot crédible et donner au geste un déclencheur clair |

Commencer avec **un geste principal et un mouvement secondaire**. Choisir le plus expressif qui peut être dessiné proprement depuis la source. Si aucune pose significative ne peut être dérivée des pixels visibles, peindre une seconde pose partielle ou remplacer le geste par une réaction réalisable, comme une inclinaison en plan avec anticipation et retour. Une variation de lumière seule compte comme VFX.

## 3. Construire les calques et reconstruire selon le mouvement

1. Découper d’abord le fond, la silhouette principale et les éléments qui passent réellement devant. Extraire ensuite les pièces qui doivent changer d’ordre ou rester rigides. Garder les parties continues sur une même surface quand leur bord commun doit se plier. Préparer les bords sur fond clair, sombre et sur le décor final, en surveillant les cheveux, plumes et contours encrés.
2. Remonter la pose source avant toute animation. Comparer au master en superposition ou par différence. Une couture visible à cette étape se corrige dans le détourage, les pixels de bord ou l’ordre des calques.
3. Pour le fond, comparer le masque du sujet au repos à sa couverture pendant les poses extrêmes et aux extrêmes de parallaxe. La différence indique les zones qui apparaîtront. Refaire le test avec les poses intermédiaires et l’interpolation active. Nettoyer l’empreinte du personnage avec une marge et inspecter le fond seul. Restaurer à la main les lignes de perspective et les motifs traversés. Un remplissage automatique peut fournir une base.
4. Pour chaque occlusion interne, dessiner la matière qui deviendra visible **sur le calque qui la porte**. Prolonger un cou sous le col, un tissu sous l’épaule, une lame derrière la tête. Pour une lame, prolonger les deux bords depuis les segments visibles et remplir toute la section avant de replacer les ombres et les détails. Pour une articulation courbe, sculpter un raccord et l’examiner dans le plan final. Une surface reconstruite dans le décor ne suit pas le mouvement du personnage.
5. Contrôler les extrêmes sur un fond de contraste avec les VFX coupés. Si une forme cachée doit changer de silhouette, préparer un dessin de remplacement ou une pose corrective. Rejouer les intermédiaires après chaque correction. [Séparation des éléments dans Live2D](https://docs.live2d.com/en/cubism-editor-manual/divide-the-material/)

### Référence validée sur Zagreus

Le [fichier maître OpenRaster](./hades-mythique/zagreus-master.ora) s’ouvre dans Krita. Il contient le décor, le détourage, les retouches de la nuque et de l’épaule sur deux calques distincts, la lame arrière, la garde avant et les feuilles. Reproduire l’export avec la commande suivante depuis la racine du dépôt et l’environnement Python qui fournit Pillow, NumPy et OpenCV.

```powershell
rtk proxy python static/_proto/hades-mythique/prepare-puppet.py <chemin-du-JPEG> --master
```

1. Poser le geste à mi-course et à son maximum pour voir exactement quelles surfaces se découvrent. Tracer les séparations à fort zoom sur le master.
2. Repeindre le cou et la peau sous la garde sur des calques indépendants avec les couleurs visibles de la même matière. Prolonger les deux bords de la lame et son biseau doré sur son propre calque. La garde avant et la lame arrière partagent le même pivot de poignée et chacune porte ses propres pixels.
3. Examiner le corps seul sur un fond contrasté. Contrôler le cou, le dessus du bras et les contours d’armure pour repérer les restes d’accessoires. Examiner l’arme seule pour repérer les trous, les copies de la garde et les interruptions du biseau.
4. Recomposer la pose source puis vérifier l’ouverture maximale, la mi-course et le retour, sans VFX. Ajouter les effets après cette validation. Contrôler également les poids réellement exportés au centre du visage et du torse, puis vérifier dans le booster que les pixels du personnage suivent le mouvement du squelette.

## 4. Fabriquer la pose avant d’animer

### Validation obligatoire du rig avant les VFX

Pour chaque personnage animé, principal ou secondaire, dresser la liste des pièces que le geste mobilise. Selon le cadrage, inclure la tête et les cheveux, le torse et le bassin, les segments des bras et des jambes, les mains, les vêtements et les accessoires. Détourer chaque pièce mobile sur un calque nommé, reconstruire ce qu’elle révèle et définir son pivot, son parent et son ordre de superposition. Pour un vêtement ou une articulation souple, le rendu peut recomposer les calques sur un même maillage, avec des influences et des points d’attache distincts.

Vérifier que **le rig utilisé dans la carte contrôle chaque pièce prévue indépendamment**. La preuve se fait dans le lecteur, avec les VFX coupés. Verrouiller la caméra et le mouvement global, puis actionner chaque pivot à tour de rôle. Contrôler le contour aux poses de repos, intermédiaire et maximale, ainsi que les contacts, par exemple la main sur la poignée. Rejouer ensuite le geste entier à la taille de la carte. Reporter les pièces testées et les raccords à reprendre avant de passer aux effets.

**Règle de séparation.** Toute pièce dont la position, la rotation ou l’ordre d’occlusion change reçoit un calque nommé dans le master. Exemples : deux oreilles indépendantes, mâchoire, arme et garde, main avec manchette, cape et rocher flottant. Retirer l’empreinte de chaque pièce du calque qui était dessous et repeindre la surface révélée. Donner aux pièces qui se touchent un pivot ou un parent commun. Une jonction souple, comme le cou ou la racine d’une aile, peut être séparée pour la retouche et recomposée sur un maillage continu pour le rendu.

Pour une cape, fixer le col et augmenter progressivement l’amplitude vers les pointes. Décaler l’onde le long du tissu et inspecter une capture en gros plan pour repérer les coutures de rendu. Pour des oreilles, séparer les deux silhouettes et leur donner des pivots distincts. Rigidifier la pointe et limiter la transition souple à la racine. Pour une arme, vérifier la prise et la trajectoire de la pointe. Sur une montée en garde, l’arme reste dans la main et sa course évite le visage.

Le contrôle se fait dans cet ordre : pièce isolée, calque sous-jacent seul, pose source recomposée, puis poses ouvertes et intermédiaires sans VFX. Une cape ou une aile peut se plier à son attache. Une arme ou un rocher doit garder sa silhouette. Si deux pièces tournent séparément, chacune doit échantillonner les pixels de son propre calque.

Les masters d’Ori, d’Ori Mythique, de Hollow Knight et de Hades de base sont dans leurs dossiers sous le nom `master.ora`. Les régénérer avec `rtk proxy python static/_proto/prepare-layered-masters.py`. Hades Mythique conserve `hades-mythique/zagreus-master.ora`, qui inclut également les oreilles, la mâchoire et la main du personnage en arrière-plan. Les masters restent des fichiers de travail, hors du build de l’Atelier.

Utiliser un outil qui permet d’éditer les poses visuellement. Live2D donne un modèle de travail pour les calques et les déformeurs hiérarchiques. Un maillage avec des poses clés dans Blender permet aussi de préparer les déformations, ou de les corriger sommet par sommet. Pour Achievers, préparer les poses dans l’éditeur puis exporter les données vers un rendu WebGL partagé. L’export depuis un éditeur supposerait un adaptateur. [Déformeurs et poses clés Live2D](https://docs.live2d.com/en/cubism-editor-manual/glossary/) · [Shape keys Blender](https://docs.blender.org/manual/en/latest/animation/shape_keys/introduction.html)

- **Pièce rigide.** Placer le pivot au point de contact et transmettre la transformation du parent. Exemple Hades. L’épée et sa garde partagent le repère de la poignée. Un point de la poignée et le point correspondant de la main doivent coïncider dans toutes les poses. Vérifier le raccord près de la nuque avec la tête en mouvement.
- **Pièce souple.** Mailler la surface en triangles qui couvrent tout l’alpha. Ajouter de la densité au pli, autour de l’œil, du cou ou de la racine d’une aile. Garder les UV fixes. Ancrer le bord immobile, puis répartir le déplacement du bord libre vers l’attache. Vérifier visuellement les triangles très étirés et détecter les retournements d’orientation par leur aire signée. [Maillage Live2D](https://docs.live2d.com/4.2/en/cubism-editor-tutorials/import/)
- **Plusieurs articulations.** Ajouter un squelette si plusieurs pièces doivent suivre des pivots. Dans les zones de raccord, partager les influences sur les mêmes sommets et vérifier les poids effectivement lus par le rendu. Stocker les cartes de poids sous forme de données opaques si elles transitent par Canvas 2D. Faire suivre une tête à son parent au niveau de la nuque et lui donner son propre angle. Le torse, le cou et la tête ont chacun un rôle dans la pose entière.
- **Correctif.** Revoir la silhouette de la pose maximale, puis corriger localement la position des sommets ou remplacer un dessin au moment où les formes changent. Si le défaut n’est visible qu’à mi-course, ajouter une pose intermédiaire. Sur Hades, examiner la séquence tête–nuque–épaule avec une bouffée légère du torse. Modifier les angles et les points d’appui avant d’augmenter la déformation de la poitrine.

## 5. Monter le mouvement et les VFX

Pour une Mythique, garder un effet signature visible sur presque toute la boucle. Placer un halo, des rayons ou un sillage sur le bon plan pour préserver la lisibilité du personnage. L’intensité peut varier au fil du geste. Vérifier aussi un moment calme de la boucle pour que la différence avec la Vivante reste visible entre deux accents.

Sur Hollow Knight Mythique, trois filaments de Vide noirs et mats ondulent en continu derrière le Chevalier. Ils se redressent à la montée de l’aiguillon, puis reviennent progressivement au repos. Garder le masque dégagé. Les rayons éclairent les poussières et le décor autour des filaments. Le Vide conserve une finition mate, sans reflet bleu.

Pour son intro, un enchaînement de trois coups d’aiguillon trace d’abord ses croissants blancs dans le noir, vers 0,4 s, 1,1 s et 1,8 s, et laisse entrevoir la scène. Un grand coup traverse ensuite la carte vers 2,4 s. La scène s’ouvre en déchirure depuis la trace de son croissant, avec un bord irrégulier et une lisière pâle, pendant que la caméra recule légèrement. Les filaments de Vide se dressent au dévoilement et le masque se tourne vers le joueur. `card-intro-reveal` part à 3,5 s. Le noir et la lumière sont deux passes plein écran, les passes 9 et 10, dessinées après la vignette. La seconde est en mélange additif.

Sous Playwright, le WebGL logiciel tourne à quelques images par seconde. Chaque image avance l’intro de 0,1 s au maximum, donc l’intro y prend du retard et la sécurité de 6 s du booster peut afficher le titre trop tôt. Contrôler les images avec `data-card-intro-time`. Mesurer le timing dans un navigateur qui utilise le GPU.

Prévoir des clignements lorsque le visage montre un œil avec une paupière plausible. Tracer la fermeture dans le repère du calque de tête et décaler les clignements entre les personnages présents dans la même scène. Pour Ori et Ku en vol, chacun a un cycle distinct. Le masque de Hollow Knight garde ses ouvertures fixes.

Pour un œil mécanique comme Wheatley, séparer l’iris, la bague mobile et le carter. Lier l’iris à la bague et limiter leur course à l’ouverture fixe. Passer d’une direction à l’autre par mouvements brefs et séparés par des arrêts. Déclencher l’éblouissement quand le regard traverse l’axe du joueur, depuis la position réelle de l’iris. Contrôler les arrêts et les extrêmes sans VFX pour vérifier la continuité du logement.

Sur Portal 2 Mythique, l’intro `"intro": "portal"` du moteur partagé ouvre d’abord un portail orange seul dans le noir, vers 0,4 s. Le portail bleu s’ouvre ensuite sur l’œil, vers 1,3 s. Les deux portails ont un bord net, une lueur intérieure et des particules sur le contour. Comme ils sont reliés, l’orange montre ce que voit le bleu. Wheatley s’allume comme une ampoule défectueuse vers 1,75 s. Il regarde à gauche, à droite et à gauche, puis se fixe sur le joueur vers 3,5 s. Le bleu grandit ensuite jusqu’à remplir la carte et l’orange se referme. `card-intro-reveal` part à 4,05 s. L’ancienne intro `"optic"` reste disponible dans le moteur. Pour une carte dont l’intro remplace le travelling du booster, `check-dev-card-set.mjs` échoue à sa dernière étape, qui attend les plans de caméra. Les contrôles précédents restent valables.

À titre de départ pour une réaction de **1,8 s**, poser la source à 0 ms, une anticipation à 200 ms, l’accent à 650 ms, un bref maintien jusqu’à 850 ms et un retour au neutre à 1 800 ms. Utiliser des tangentes adoucies sur les poses qui s’arrêtent. Vérifier le retour au même repère de repos pour que la reprise reste invisible. Dans un portrait, les yeux peuvent initier le mouvement et la tête suivre avec un retard de quelques images. Dans un corps entier, un appui ou une épaule peut initier la réaction. Décaler ensuite les éléments libres, comme une mèche ou une cape, pour qu’ils se stabilisent après le corps.

En inspection, laisser le joueur voir le premier accent rapidement après l’ouverture, puis espacer les répétitions avec une attente qui varie légèrement. En révélation Mythique, déclencher le geste quand le sujet est lisible et la caméra proche de sa pose finale. Au rejeu, relancer depuis la même pose. Pour la validation, conserver un mode de prévisualisation à temps imposé et sans VFX.

Sur Hadès Mythique, l’intro montre la remontée du Styx, la boucle du roguelike. De 0,3 s à 2,3 s, la carte montre le bassin de sang vu de dessus. Le sang est visqueux, avec des reflets qui glissent, des ondes concentriques et quelques bulles qui éclatent. Vers 1,85 s, une onde de surface annonce la remontée. De 2,3 s à 3,9 s, le sang s’écoule vers le bas et Zagreus remonte d’environ 70 px. Le sang laisse des coulures fines et brillantes, plus épaisses en bas, et un reflet humide sur la silhouette tout juste découverte. Vers 3,3 s, l’œil rouge s’allume. Vers 3,8 s, un éclair rouge modéré ravive la couronne. `card-intro-reveal` part à 3,95 s. Tout le Styx est dessiné dans la passe finale, au-dessus de la scène complète. Les passes du décor et de la marionnette ne s’assombrissent plus pendant l’intro. Dans le booster, Hadès fait partie des cartes dont l’intro remplace le travelling. En inspection (collection, booster, cartes à créer), ouvrir une Mythique rejoue son intro, puis sa boucle ; « Rejouer l’animation » la relance. Dans le booster, la Mythique se charge face cachée pendant les indices, et le filet du titre compte depuis le moment où la carte tourne : une carte longue à charger en production garde son intro.

Sur Ori Mythique, le teaser se joue d’abord dans la nuit, de 0,4 s à 2,3 s. La lumière d’esprit d’Ori, un cœur blanc-bleu avec halo et traîne, tourne autour de la plume sombre de Kuro, qui tombe en tournoyant. La plume est dessinée dans le shader, avec un rachis, deux vanes inégales et des encoches, et elle n’est éclairée que par cette lumière. Vers 2,3 s, la lumière s’envole vers le coin supérieur droit, d’où arrive Ku. L’aube se lève depuis ce point avec un bord nuageux fin, et le souffle emporte la plume vers le bas à gauche. `card-intro-reveal` part à 4,6 s, quand le duo est presque arrivé. Ensuite, ouvrir sur le décor en faisant défiler séparément le ciel et les rochers. Ori et Ku arrivent du bord supérieur droit dans le sens du vol de Ku, puis la caméra ralentit jusqu’au cadrage de la boucle. Dans le booster, cette intro remplace le travelling qui dévoilerait les personnages trop tôt. Retarder le titre, le cadre thématique et le retournement du recto dans la grille jusqu’à l’arrivée du duo. Contrôler le fond reconstitué et garder le point d’appui d’Ori solidaire de Ku pendant l’entrée.

### Intro des Mythiques : un teaser du jeu

L’intro sert de teaser. Elle dévoile la carte comme une bande-annonce. Un joueur qui connaît le jeu doit savoir lequel il a tiré **avant** de voir l’illustration. Pendant le noir, montrer donc un signe que seul ce jeu possède : un symbole de l’interface, un son visuel, une mécanique ou un objet emblématique. Les mouvements de caméra, les volets et les particules génériques ne suffisent pas.

1. **Ouvrir sur un signe du jeu, seul dans le noir.** Le signe doit se lire à la taille d’une carte dans la grille, dès la première demi-seconde.
2. **Révéler l’image par un élément de l’image.** La lumière vient d’une lame, d’un œil, d’un impact ou d’une source peinte dans l’illustration. La révélation part de ce point. Un volet qui balaie la carte n’est pas une révélation.
3. **Tenir un geste en trois temps : annonce, action, conséquence.** Les VFX de la boucle naissent de la conséquence, comme des feuilles soufflées ou des étincelles qui retombent.
4. **Synchroniser la boucle et l’intro.** Faire tourner la boucle pendant le noir pour que le dévoilement montre la pose d’accent. Finir sur la pose de la boucle, sans coupure.
5. **Compter 3,5 à 4 s jusqu’au dévoilement.** Le teaser doit tenir assez longtemps pour qu’on devine le jeu. Laisser le signe seul dans le noir pendant au moins une seconde. Garder les gestes vifs : un coup ou une ouverture de portail dure quelques dixièmes de seconde, et c’est l’attente entre les temps forts qui s’allonge. Envoyer `card-intro-reveal` au dévoilement pour faire entrer le titre et le cadre dans le booster, avant son repli de 6 s.
6. **Vérifier l’intro image par image avec `data-card-intro-time`.** Ce paramètre fige l’intro et la boucle à l’instant donné. Contrôler chaque temps fort, ainsi que les bords de la vue pendant les secousses.

Sur Hadès Mythique, le reflet de la lame et l’œil rouge de Zagreus servent de modèle.

Un symbole d’interface se reprend depuis une capture du jeu plutôt que d’être redessiné ou tapé dans une police : sa forme et ses couleurs sont celles que le joueur reconnaît. Détourer seulement le cœur clair. Boucher les trous laissés par la compression vidéo. Refaire ensuite la lueur dans la carte avec des ombres seules, sans anneaux. Conserver la capture et le script de détourage dans le dossier de la carte.

Sur Sekiro Mythique, le kanji 危, l’avertissement d’attaque imparable du jeu, s’allume seul au-dessus du moine vers 0,35 s et reste seul jusqu’à 2 s. Son cœur rose pâle vient de `kanji-source.webp`, détouré par `prepare-kanji.mjs` dans `kanji-danger.png`, et la carte lui ajoute une lueur rose-rouge continue. La poussée de la lance suit sous forme d’un éclat qui file de la prise jusqu’à la pointe et éclaire la hampe, de 2,05 s à 2,62 s. Vers 2,75 s, la hache du Loup frappe : une étoile de parade, une secousse et une gerbe d’étincelles, pendant que le 危 se dissipe. La lumière du choc ouvre la scène depuis la hache avec un bord irrégulier bordé de braises. Les érables soufflés par l’impact rejoignent la boucle. La boucle part décalée de 1,2 s avant l’intro, si bien que le saut du Loup a lieu dans le noir et que le choc coïncide avec le pic d’étincelles de la boucle, à 1,55 s dans son cycle. `card-intro-reveal` part à 3,7 s. L’ombre de l’intro est rendue en basse résolution avec une marge noire, pour que le lissage et la secousse ne laissent jamais apparaître un filet clair au bord.

Animer le décor sur ses propres plans. Isoler les rochers flottants, fleurs et figures secondaires qui ont un mouvement identifiable, puis retirer leurs empreintes du fond. Faire pivoter les fleurs autour de la tige et donner à chaque rocher une phase différente. Une créature au second plan peut respirer ou tressaillir entre les gestes du personnage principal. Pour une respiration du héros, synchroniser une légère montée du haut du torse avec la tête et l’épaule. Garder les appuis au sol et contrôler que le bassin et le bras conservent leur anatomie.

Partir de la lumière peinte dans l’image pour orienter les godrays. Faire osciller lentement l’angle, la largeur ou l’intensité des faisceaux. Placer les rayons et les poussières du halo derrière la silhouette du personnage, comme sur Hollow Knight Mythique. Un effet circulaire permanent peut garder un rayon fixe et frémir sur son contour, comme la couronne de Zagreus. Sur Ori, le sillage bleu persiste entre les battements. Utiliser le battement ou la montée en garde pour accentuer l’effet déjà présent.

1. Choisir un effet d’ambiance cohérent avec la scène et un accent lié au geste. Par exemple, des braises passent derrière Zagreus, puis un reflet parcourt la lame au sommet de la montée en garde.
2. Fixer le point d’émission dans le repère du bon calque ou du bon os. Une étincelle qui quitte la lame continue dans le repère scène après sa naissance. Un reflet qui glisse sur la lame reste dans son repère.
3. Composer le fond, ses VFX, le personnage et ses accessoires dans l’ordre d’occlusion, puis les effets proches. Masquer ou réduire leur opacité autour des yeux et des contours qui doivent rester lisibles. Sur Ori, le vent et les feuilles suivent le sens du miroir. Les rochers prennent chacun une phase et un axe de flottement distincts.
4. Vérifier une fois avec uniquement le corps, une fois avec caméra et parallaxe, puis avec les VFX et le cadre. Un défaut qui réapparaît dans une seule passe se corrige dans le calque ou le repère concerné.

### Moteur commun : une carte décrite par des données

Une nouvelle carte se décrit dans `scene.json` (`"engine": 2`) et se rend avec `shared/card-engine.js`. Son `cards.js` ne fait que charger ce moteur, comme celui de Sekiro Mythique. Le code sur mesure reste une exception, réservée à une Mythique qui demande un effet que le moteur n’a pas encore. Dans ce cas, ajouter l’effet ou l’intro au catalogue du moteur plutôt qu’à la carte.

- **Fenêtre et boucle.** `view` donne la fenêtre visible en pixels de la source. `period` donne la durée de la boucle, et `curves` nomme les accents `[début, sommet, maintien, fin]`.
- **Calques.** Ils sont listés dans l’ordre de dessin, avec `file`, `origin` ou `crop` (une zone d’une planche), `pivot`, `parent` et `parallax`. Un calque sans `file` est un groupe : ses enfants héritent de son pivot, de sa parallaxe et de ses mouvements. Un mouvement déplace (`dx`, `dy`), tourne (`angle`) ou étire (`sx`, `sy`) le calque autour de son pivot. Il suit un accent (`curve`), un signal (`signal`), une oscillation (`wave`), une respiration (`"shape": "breath"`) ou une oscillation qui part du repos (`"shape": "settle"`). Une Relief ne bouge qu’avec le pointeur.
- **Signaux.** `signals` nomme des grandeurs, comme le vent ou un regard : une base, des oscillations, des accents pondérés, des étapes `[début, fin, poids]` et des flashs `[début, sommet, fin, poids]`.
- **Tissus et maillages.** `sway` fait onduler une mèche ou une cape bande par bande (lignes ou colonnes) depuis un bord ou une attache centrale. `mesh` découpe le calque en triangles et lui applique des ondes (`wave`) et des plis (`bend` : la pointe tourne plus que la base, pour une aile ou un pan). Les maillages passent par un contexte WebGL unique et partagé ; le reste de la carte est en Canvas 2D. Pour une cape ou une crinière larges, préférer `mesh` avec une onde `wave` : `sway` décale chaque bande d'un nombre entier de pixels, et une grande amplitude y dessine des marches visibles en gros plan (Hollow Knight Vivante, version 1). Quand le même calque porte une pièce qui ne doit pas onduler, comme le bras qui tient l'aiguillon, `hold: [x, y, largeur, hauteur, fondu]` l'immobilise dans l'onde ; la pièce suit alors seulement son parent.
- **Zones souples.** Dans `mesh.deform`, une `zone` fait tourner, glisser ou s’étirer une partie du calque autour d’un `pivot`, sans la détacher : tête, bras, mâchoire, paupière, mèche. Elle se délimite par un `polygon` et son `feather`, ou par `center`, `radius` et `core`. Les poids se lisent au repos, et les zones se composent dans l’ordre : mettre le torse avant la tête. `motion` suit les mêmes accents que les calques, `ripple` ajoute une onde, `look` suit le pointeur (Vivante et Mythique seulement). `xs` et `ys` ajoutent des lignes au maillage près d’un œil. `data-card-joint="calque:zone"` isole une zone. Une pièce rigide et longue, comme une lame, doit tenir entière dans le cœur d’une seule zone, sinon elle se tord (Baldur’s Gate 3).
- **Découpage et miroir.** `clip` découpe un calque par un contour posé dans le repère d’un autre, comme un œil dans son logement. `mirror` retourne la carte, et `fill` colore la marge.
- **Fond.** `background` accepte `parallax`, `offset`, `grow`, `size` et `drift` (une dérive de l’air).
- **Effets** (`EFFECTS`). Le catalogue contient `mist`, `rays`, `leaves`, `sparks`, `glint`, `flames`, `embers`, `cinders`, `halo`, `lens`, `motes`, `beamDust` et `rising`. Un effet se dessine avant un calque (`before`), attaché à un calque (`attach`), dans le repère d’un calque sans son découpage (`frame`) ou au premier plan. `parallax: "background"` le colle au décor, `blend` choisit le mélange (`screen` par défaut), et `hideDuringIntro` le garde éteint pendant le dévoilement.
- **Intros** (`INTROS`). Le catalogue en contient cinq. `strike` (Sekiro) enchaîne un symbole du jeu, une poussée, un impact et une déchirure. `portal` (Portal 2) ouvre deux portails reliés, pendant que les regards du sujet remplacent ceux de la boucle. `slash` (Hollow Knight) trace des croissants, puis ouvre une déchirure. `dawn` (Ori) fait tourner une lumière autour d’une plume, puis lève l’aube depuis un coin. `drain` (Hadès) écoule un liquide pendant que la scène remonte. `revealAt` doit être identique dans `scene.json` et dans `edition.json`.
- **Contrôles.** Le test du catalogue vérifie chaque scène en données : fichiers présents, parents, cadres et découpages, courbes, sprites, effets et intro connus, dévoilement cohérent avec le manifeste. `check-dev-card-set.mjs` isole chaque pivot, passe par le sommet de chaque accent, vérifie le retour au repos quand la scène n’a pas de mouvement continu, puis contrôle le booster (travelling ou intro).
- **Publication.** Le module de moteur importé par `../shared/` est recopié dans la carte publiée. Les pages et polices de l’atelier n’en font pas partie.

Portages en données, comparés image par image à la version sur mesure : Sekiro (Relief, Vivante, Mythique), Portal 2 (Relief, Vivante, Mythique) et Hollow Knight (Relief, Vivante). Les écarts restent dans le bruit de capture. Pour comparer, capturer les deux versions avec une horloge pilotée (Playwright `page.clock`) et mesurer l’écart. Deux lancements d’une même version diffèrent déjà de quelques milliers de pixels.

**Collection.** La page de collection lit les cartes par pages de 48, de la plus rare à la plus récente, avec des filtres par rareté et par nom de jeu ; ses compteurs viennent de la base. Chaque édition compte ses propriétaires (`GameEdition.ownerCount`, mis à jour à l’ouverture), et l’inspection affiche la part des collectionneurs qui la possèdent. Les grilles n’animent aucune carte : seule l’inspection ou la révélation monte une carte animée. Une carte qui ne charge pas (manifeste illisible, identifiant absent de `cards.js`, erreur du rendu) est signalée au journal du serveur sous « carte <dossier> ».

**Exceptions sur mesure.** Cinq cartes WebGL restent faites à la main, parce qu’elles reposent sur des shaders propres à leur scène : Ori (Relief, Vivante, Mythique), Hadès (Relief, Vivante, Mythique) et Hollow Knight Mythique (dossier `hollow-knight`). Elles gardent le même contrat (`mount`, `data-card-intro-time`, `card-intro-reveal`) et se porteront si une retouche le demande. Une nouvelle carte part toujours du moteur commun.

## 6. Appliquer les éditions et intégrer

- **Relief**. Utiliser le visuel héro de la bibliothèque Steam du jeu (`library_hero.jpg`), partagé avec Vivante. Seuls les plans répondent au pointeur. L’illustration se stabilise quand le pointeur s’arrête.
- **Vivante**. Reprendre le même visuel héro Steam avec parallaxe, idle break et VFX. La scène peut partir d’un seul personnage, d’un fond et d’un premier plan optionnel.
- **Mythique**. Second artwork du même jeu. Appliquer le même processus avec une pose signature plus travaillée, davantage de détails et des VFX synchronisés. Garder le trajet de révélation **gauche → droite → centre**, même si le rendu est inversé. Adapter le zoom aux pixels réellement disponibles et finir à `zoom: 1`.

Dans les deux premiers plans, choisir deux détails éloignés et vérifier le cadrage réel dans le booster. Le zoom et la position du pivot déterminent ensemble la portion visible. Un gros plan trop proche du centre répète souvent la même silhouette. Pour garder la surprise, cadrer d’abord des détails comme la lame, un appui ou le décor et réserver le masque ou le visage au retour au centre. Vérifier l’ordre après miroir, la version accélérée et la lisibilité au zoom retenu.

Pour évoluer depuis les POC, partager la lecture de la scène, les calques, les déformeurs, l’interpolation, la parallaxe et le cycle de vie. Garder la direction artistique dans les données de la carte. Chaque scène décrit la résolution et la fenêtre source, les plans et leur profondeur, les calques et leur ordre, les pivots et attaches, les maillages et positions des poses clés, les clips et les émetteurs. Les sommets d’un même maillage gardent le même index et les mêmes UV dans toutes leurs poses. Une pose de remplacement à topologie différente est un calque distinct dont la visibilité est définie par la timeline. `edition.json` garde son rôle dans la révélation. Le format des données d’animation est une proposition pour le moteur partagé.

Un dossier de rendu par artwork suffit. Relief et Vivante peuvent partager le même dossier et le même script ; la Mythique référence un dossier distinct.

```text
static/_proto/<jeu>/
  source.*                   Image d’origine conservée pour la fabrication.
  prepare-*.mjs ou .py       Export reproductible des masques et des textures.
  full.jpg                   Repli fixe dans le cadrage final.
  bg.jpg                     Décor reconstitué, éventuellement plusieurs plans.
  depth.png                  Facultatif, avec interprétation des canaux documentée.
  <calques>.png              Pièces découpées avec alpha.
  cards.js                   Rendu et cycle de vie WebGL.
  edition.json               Identifiant, ambiance et plans de caméra.
static/_proto/<jeu>-mythique/
  …                          Même contrat, autre illustration et réglages dédiés.
```

- **Script.** Enregistrer `window.AchieversCards[id]` avec une méthode asynchrone `mount(canvas, level)` qui renvoie une fonction de nettoyage. Le chargeur utilise l’`id` du manifeste et transmet **2 pour Relief, 3 pour Vivante et Mythique**. Résoudre les textures à partir du dossier de `cards.js` et partager les chargements entre instances. Arrêter les écouteurs, la boucle et les ressources WebGL au démontage. Tenir compte de `data-card-suspended`, du document masqué et de `prefers-reduced-motion`.
- **Qualité.** Dimensionner le canvas à sa taille CSS avec une densité de pixels plafonnée. Les POC limitent le coût dans la grille et augmentent la qualité en gros plan via `data-card-quality="grid"` et `data-card-quality="close-up"`. Le premier affichage du recto s’appuie sur l’image fixe. Ne pas attendre les textures ou la compilation WebGL pour montrer le recto.
- **Manifeste.** Déclarer des cibles normalisées `x` et `y` en coordonnées de carte affichée, des facteurs `zoom` et des durées en millisecondes. Exemple pour une Mythique :

```json
{
  "id": "jeu-mythique",
  "glow": "#ffc88a",
  "atmosphere": "wisps",
  "sound": null,
  "shots": [
    {
      "from": { "x": 0.08, "y": 0.7, "zoom": 1.75 },
      "to": { "x": 0.26, "y": 0.55, "zoom": 1.75 },
      "duration": 1700
    },
    {
      "from": { "x": 0.76, "y": 0.26, "zoom": 1.6 },
      "to": { "x": 0.76, "y": 0.68, "zoom": 1.6 },
      "duration": 1700
    },
    {
      "from": { "x": 0.5, "y": 0.56, "zoom": 1.45 },
      "to": { "x": 0.5, "y": 0.5, "zoom": 1 },
      "duration": 1900
    }
  ]
}
```

- **Intégration.** Un jeu entre dans les boosters par `src/lib/card-catalogue.json` : son identifiant Steam, `version` et le dossier d’atelier de chaque édition (`RELIEF`, `VIVANTE`, `MYTHIQUE`). Le test `src/lib/card-catalogue.test.ts` refuse un dossier sans `full.jpg`, sans manifeste valide, dont `cards.js` n’enregistre pas l’identifiant du manifeste, ou qui dépasse 6 Mo publiés. L’intro, le cadre (`frame`) et le style du titre (`title`) se déclarent dans `edition.json`, jamais dans les composants. La galerie et `/dev/boosters` lisent le catalogue et montrent l’atelier (`/_proto/…`). L’image fixe d’une édition est toujours son `full.jpg`.
- **Publication.** `node scripts/publish-cards.mjs` copie chaque dossier d’atelier, sans les fichiers de fabrication, dans `cards/<dossier>/<version>/`. Le moteur partagé est recopié dans la carte et son import `../shared/` devient `./shared/`. La publication calcule aussi `thumb.webp`, une miniature de 460 px de large (une dizaine de Ko) que la collection et l’historique des boosters affichent à la place de `full.jpg`. `scripts/nas-cards.sh` envoie ensuite au NAS les versions qui lui manquent, et le site les sert aussitôt sous `/cartes/<dossier>/<version>/`, avec un cache d’un an. Une version publiée n’est jamais réécrite : pour retoucher une carte, incrémenter `version` dans le catalogue, publier, envoyer, puis commiter le catalogue. L’entretien horaire recopie la nouvelle adresse en base. `static/_proto` reste l’atelier et n’entre plus dans l’image Docker.
- **Cadre.** Réutiliser ou ajouter une famille dans `src/lib/card-frame.ts` d’après l’univers du jeu. Le cadre standard sert de repli. Dessiner la matière et la gravure pour Relief ; ajouter les coins et un ornement animé pour Vivante ; réserver à Mythique la silhouette complète, les finitions et le mouvement signature. Le cartouche et la frise sous l’illustration peuvent prolonger le motif. Laisser les pièces qui débordent hors du conteneur recadré de l’image.
- **Révélation.** Le cadre suit le survol dans l’inspection et se déploie sur la carte entière à la fin de la scène Mythique. Les flashs, rayons et particules du booster sont placés derrière la carte. Le rendu statique en mode animations réduites conserve les détails du cadre.

## 7. Valider sur des cartes différentes

| Test                     | Résultat attendu                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source et première image | Même cadrage et mêmes repères. Le recto fixe apparaît dès le retournement. Le canvas prend le relais sans saut une fois prêt.                                                                                                   |
| Personnage seul          | Le geste se lit à la taille d’une carte. L’appui, le cou et les contacts restent cohérents. Vérifier repos, anticipation, accent, retour et intermédiaires en lecture normale et à vitesse réduite.                             |
| Occlusions               | Balayer le clip aux extrêmes de parallaxe et au zoom maximum. Rechercher un trou dans la lame, une fente au cou, une ombre du sujet dans le fond ou un élément qui sort du cadre. Vérifier le miroir et le cadrage mobile.      |
| VFX                      | Les effets suivent leurs points d’émission et laissent les détails clés lisibles. Désactiver chaque passe individuellement pour isoler un défaut.                                                                               |
| Interface                | Contrôler ouverture manuelle, « Révéler les Relief », « Tout retourner » (rapide, sans scène Mythique), travelling Mythique, cadre à la fin, inspection, rejeu et bannière. Les flashs de révélation passent derrière la carte. |
| Rendu et repli           | Vérifier les chargements d’assets, plusieurs cartes visibles, les ressources libérées à la fermeture et le repli fixe avec WebGL indisponible ou en mouvement réduit.                                                           |

Pour éprouver la méthode, reprendre **Zagreus** pour les raccords rigides et le cou, **Ku** pour la morphologie non humaine et les occultations du fond, puis un **portrait serré** avec un idle break du visage. Pour chaque essai, conserver la source et le fichier de travail, les trois poses, une courte capture avec et sans VFX, et les assets exportés. Le résultat doit fonctionner dans le booster. Un défaut qui n’apparaît qu’en lecture normale compte autant qu’un défaut sur une pose arrêtée.

Faire une première passe dans `/dev/boosters`. Pour une carte ajoutée à l’Atelier, inscrire les fichiers servis dans `sites/achievers-atelier/build.mjs` et rejouer le parcours sur le build. Les [notes des POC](./WORKFLOW.md) conservent les détails d’implémentation des scènes existantes.

Dans `/dev/cartes-animees`, comparer aussi les trois éditions par jeu. Survoler une Relief et vérifier que seule la parallaxe répond, observer une Vivante puis une Mythique sur une boucle entière et ouvrir l’inspection pour tester le rejeu. Vérifier que les aperçus hors écran sont démontés, que la grille se met en pause pendant l’inspection et que le poster reste disponible pendant le chargement et en mouvement réduit. Le contrat `mount` et ces contrôles s’appliquent aux rendus WebGL et Canvas 2D.
