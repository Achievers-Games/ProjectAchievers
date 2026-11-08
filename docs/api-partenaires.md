# API partenaires : Achievers ↔ Lure

Plan pour relier Achievers et [Lure](https://lureverse.fr) tout en gardant deux sites, deux bases et
deux déploiements indépendants. Chaque site reste maître de ses comptes ; ils se parlent par une API
versionnée et par une liaison de comptes que le joueur accepte lui-même.

## 1. Ce qui est déjà en place

| Élément                                              | Où                          | État |
| ---------------------------------------------------- | --------------------------- | ---- |
| Diapositive « Tu sais pas à quoi jouer ? » vers Lure | `HomeCarousel.svelte`       | fait |
| Carte de joueur intégrable (SVG)                     | `GET /u/{handle}/carte.svg` | fait |
| Bouton « Carte de joueur » (copie le lien)           | profil public               | fait |

La carte s'intègre partout avec une simple image :

```html
<img
  src="https://<achievers>/u/ada/carte.svg"
  width="600"
  height="180"
  alt="Carte Achievers de Ada"
/>
```

Elle respecte les profils privés (404), les jeux masqués, et n'embarque aucune ressource externe
(l'avatar est intégré en `data:`), donc elle fonctionne aussi dans un README GitHub.

## 2. Le double OAuth : oui, et voici comment

« Se connecter avec Achievers » sur Lure et « Se connecter avec Lure » sur Achievers, c'est faisable :
chaque site devient **fournisseur OAuth 2** (il délivre des jetons) **et client** de l'autre.

```
Lure  ── « Se connecter avec Achievers » ──▶  Achievers /oauth/authorize  (fournisseur)
Achievers ── « Se connecter avec Lure » ──▶  Lure /oauth/authorize        (fournisseur)
```

Règles à fixer dès le départ, pour éviter les mauvaises surprises :

1. **Jamais de fusion automatique par e-mail.** La connexion par l'autre site crée un compte ou se
   rattache à un compte _déjà ouvert dans la session_, exactement comme Steam ou Discord aujourd'hui.
2. **Un lien, deux sens.** Une fois Achievers relié depuis Lure, Lure peut appeler l'API d'Achievers
   avec le jeton reçu ; l'inverse est indépendant et demande son propre consentement.
3. **Révocable des deux côtés.** Délier sur un site révoque ses jetons ; l'autre site reçoit une
   erreur `401` et propose de relier à nouveau.

### Ordre conseillé

- **D'abord Achievers fournisseur.** C'est Lure qui a besoin de nos données (progression des
  succès) pour proposer « finir un jeu à 100 % ». C'est aussi ce qui débloque l'API privée.
- **Ensuite « Se connecter avec Lure » côté Achievers.** Côté code, c'est un fournisseur de plus :
  `src/lib/server/providers/lure.ts` sur le modèle de `discord.ts`, une valeur `LURE` dans l'énum
  `Provider`, et la route existante `src/routes/auth/[provider]` fait le reste (PKCE déjà géré par
  `fetchOAuthProfile`). À faire dès que Lure expose son propre `/oauth/authorize`.

### Liaison automatique par les identités OAuth : oui, sans double OAuth

Les deux sites utilisent Discord, Steam, Google, Xbox… et **ce n'est pas grave s'ils utilisent deux
applications OAuth différentes** : l'identifiant que le fournisseur renvoie est global, il ne dépend
pas du client qui le demande.

| Fournisseur | Identifiant stable | Vérifié par  |
| ----------- | ------------------ | ------------ |
| Discord     | `id` (snowflake)   | Discord      |
| Steam       | SteamID64          | Steam OpenID |
| Google      | `sub`              | Google       |
| Xbox        | XUID               | Microsoft    |
| Epic        | `sub`              | Epic         |
| Blizzard    | `sub`              | Battle.net   |
| PSN         | `accountId`        | code en bio  |

Achievers stocke déjà ce couple dans `LinkedAccount`, avec `@@unique([provider, providerUserId])`.
Si Lure stocke le même couple, alors **deux comptes qui ont vérifié la même identité Discord auprès
de Discord sont la même personne** : aucun des deux sites n'a à croire l'autre sur parole, la preuve
vient du fournisseur.

À la connexion, Achievers peut donc demander à Lure « as-tu un compte lié à ces identités ? » et
relier tout seul. Et réciproquement.

Ce que ça ne permet pas :

- **Deux fournisseurs différents d'un côté et de l'autre.** Discord sur Achievers + Steam sur Lure
  ne donne aucune clé commune. Il faut une liaison manuelle (« Relier mon compte Lure » depuis
  `/compte`), ou le double OAuth ci-dessus.
- **De deviner par e-mail, pseudo, handle ou avatar.** Jamais : c'est le vecteur classique de prise
  de contrôle d'un compte.
- **De partager des données.** Un lien dit « même personne », pas « accès aux données ». Pour lire
  la progression privée, le jeton OAuth du §3 reste nécessaire.

#### Le point d'entrée de recherche

Un seul, dans chaque sens, authentifié par la clé partenaire déjà en place (`ak_…`, serveur à
serveur, jamais dans le navigateur) :

`POST /api/v1/partner/identities/lookup`

```json
{
  "identities": [
    { "provider": "DISCORD", "providerUserId": "123456789012345678" },
    { "provider": "STEAM", "providerUserId": "76561198000000000" }
  ]
}
```

Réponse : la liste **distincte** des comptes partenaires trouvés (vide si aucun).

```json
{ "partnerUserIds": ["usr_…"] }
```

On envoie **toutes** les identités du compte, pas seulement celle de la connexion : quelqu'un peut
avoir lié Discord et Steam ici, et seulement Steam là-bas.

#### À la connexion, côté Achievers

1. `resolveIdentity` a rendu le compte local (créé ou existant).
2. S'il n'a pas encore de lien Lure, appel à Lure avec ses identités (délai 2 s, jamais bloquant :
   une panne de Lure ne doit pas empêcher de se connecter).
3. Un seul compte Lure trouvé → `PartnerLink` créé, mention discrète « Compte Lure relié ».
4. Aucun → rien.
5. **Deux comptes Lure différents trouvés** (Discord → L1, Steam → L2) → aucune liaison
   automatique : on demande au joueur lequel garder, comme la fusion existante (`merge.ts`).

Le même algorithme tourne chez Lure, avec le même point d'entrée côté Achievers.

#### Modèle de données

```prisma
model PartnerLink {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  partner       String    // « lure »
  partnerUserId String
  method        String    // AUTO | MANUAL
  createdAt     DateTime  @default(now())
  revokedAt     DateTime?

  @@unique([partner, partnerUserId])
  @@unique([userId, partner])
}
```

Le lien est révocable des deux côtés et survit à une fusion de comptes : `merge.ts` doit déplacer la
ligne, comme les autres tables par utilisateur.

#### Rattrapage des comptes existants

Les joueurs déjà inscrits sur les deux sites n'ont pas de lien tant qu'ils ne se reconnectent pas
quelque part. Pour les relier d'un coup, chaque site envoie une liste de **HMAC** des identités
(`HMAC(clé partagée, "DISCORD:123…")`) : les empreintes se comparent sans que ni l'un ni l'autre ne
reçoive les identifiants en clair.

#### Sécurité et vie privée

- Le point d'entrée répond seulement « ces identités correspondent à ces comptes » : jamais de nom,
  d'avatar ni de jeu.
- Clé invalide → `401` ; limite de débit par clé, comme le reste de `/api/v1`.
- Une clé volée permet d'énumérer l'existence d'un compte pour une identité donnée : clé côté
  serveur uniquement, rotation possible depuis Modération → Sites partenaires.
- Prévenir dans `/confidentialite` et permettre de délier depuis `/compte`.

#### Pourquoi garder le double OAuth

La recherche d'identités relie les comptes, mais ne donne aucun droit de lecture. Le double OAuth
reste la bonne façon de faire circuler les données privées, et « Se connecter avec Lure » donne un
identifiant unique (`sub` = compte Lure) plus simple à raisonner que N identités de fournisseurs.
Ordre conseillé : la recherche d'identités d'abord (petite, utile tout de suite), le double OAuth
ensuite.

## 3. Achievers fournisseur OAuth 2

Sous-ensemble minimal et standard, pas d'OIDC complet au départ :

- **Flux** : _Authorization Code_ + **PKCE obligatoire** (RFC 6749, RFC 7636, recommandations de
  la RFC 9700). Pas de flux implicite, pas de mot de passe.
- **Points d'entrée**
  - `GET /oauth/authorize` : page de consentement (« Lure veut voir tes jeux et tes succès »),
    connexion demandée si besoin.
  - `POST /oauth/token` : échange du code, puis rafraîchissement (`refresh_token`, rotation à
    chaque usage).
  - `POST /oauth/revoke` : révocation par le partenaire.
- **Portées**
  - `profile` : nom, identifiant, avatar.
  - `library` : jeux et progression (respecte les jeux masqués).
  - `achievements` : détail des succès débloqués.
- **Jetons** : opaques, aléatoires (32 octets), **stockés hachés** (SHA-256) ; accès 1 h,
  rafraîchissement 60 jours. `redirect_uri` comparée à l'identique avec la liste enregistrée.
- **Côté joueur** : section « Applications reliées » dans `/compte` (voir, révoquer), et mention
  dans `/confidentialite`.

### Modèle de données (Prisma)

```prisma
model PartnerApp {
  id           String   @id @default(cuid())
  name         String              // « Lure »
  clientId     String   @unique
  secretHash   String              // jamais le secret en clair
  redirectUris String[]
  /// Clé publique pour les routes sans joueur (limitation de débit, statistiques).
  apiKeyHash   String   @unique
  createdAt    DateTime @default(now())
  grants       OAuthGrant[]
}

model OAuthGrant {
  id         String     @id @default(cuid())
  userId     String
  appId      String
  scopes     String[]
  createdAt  DateTime   @default(now())
  revokedAt  DateTime?
  tokens     OAuthToken[]
  @@unique([userId, appId])
}

model OAuthToken {
  id        String     @id @default(cuid())
  grantId   String
  kind      String     // CODE | ACCESS | REFRESH
  hash      String     @unique
  expiresAt DateTime
  usedAt    DateTime?  // un code ou un rafraîchissement ne sert qu'une fois
}
```

## 4. L'API v1

Base : `https://<achievers>/api/v1`. JSON, dates ISO 8601, pagination par curseur, erreurs
`{ "error": "code", "message": "…" }`. Description OpenAPI servie sur `/api/v1/openapi.json`.

### Identifier un jeu entre les deux sites

Lure identifie ses jeux par **appid Steam** (`https://lureverse.fr/jeu/683320`). Achievers stocke
déjà le couple (`platform`, `platformGameId`) : pour Steam, c'est ce même appid. L'adresse de
l'API reprend donc celle de Lure : `/api/v1/games/steam/683320`.

Pour un simple lien, sans clé ni appel d'API, `https://<achievers>/jeux/steam/683320` redirige
vers la fiche du jeu (`/jeux/<nom-du-jeu>`), en gardant les paramètres (`?utm_source=lure`).
Même forme pour les autres plateformes : `/jeux/psn/…`, `/jeux/xbox/…`. Les fiches gardent leur
adresse lisible, utile au partage et au référencement.

### Routes publiques — en place

Chaque appel porte la clé : `Authorization: Bearer ak_…`. Les administrateurs la créent, la
remplacent ou la révoquent dans **Modération → Sites partenaires** ; elle ne s'affiche qu'une fois
et seule son empreinte SHA-256 est gardée.

| Méthode | Route                                   | Contenu                                                                                                |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET     | `/users/{handle}`                       | nom, avatar, clan, lien de la carte, stats (jeux, succès, cartes…)                                     |
| GET     | `/users/{handle}/games`                 | jeux et progression, `?platform=steam`, `?sort=`, `?status=`, `?since=`, `?limit=` (≤ 100), `?cursor=` |
| GET     | `/users/{handle}/games/{platform}/{id}` | progression d'un jeu et chaque succès, obtenu ou non                                                   |
| GET     | `/games/{platform}/{id}`                | fiche du jeu, joueurs publics, taux de 100 %, difficulté, guides, temps médian                         |
| POST    | `/games/lookup`                         | les mêmes fiches pour 100 jeux au plus en un appel                                                     |
| GET     | `/openapi.json`                         | description OpenAPI 3.1, lisible sans clé                                                              |

### Ce que la fiche d'un jeu dit de son 100 %

C'est ce que Lure n'a pas ailleurs : de quoi annoncer « 100 % accessible : aucun manquable, guide
disponible, environ 12 h ».

- `difficulty.missableAchievements` : succès qui peuvent se perdre pour la partie en cours.
  `difficulty.missablesReviewed` dit si ce compte est complet (un guide officiel a relevé tous
  les succès) ou s'il ne contient que les manquables déjà connus.
- `difficulty.rarestAchievement` : pourcentage de joueurs Steam qui ont le succès le plus rare.
- `guides.achievementsCovered` : succès qui ont au moins un guide lisible (officiel, ou pas
  enterré par les votes). `guides.gameGuides` : guides complets du jeu ;
  `guides.bestGameGuideUrl` mène au guide officiel, sinon au mieux noté.
- `completionTime` : temps de jeu médian (temps Steam) des joueurs publics à 100 %, avec la
  taille de l'échantillon. `null` sous cinq joueurs : trop peu pour dire quelque chose, et
  jamais le temps d'un joueur seul. C'est une médiane, à afficher comme « environ ».

### Recherche groupée

Une bibliothèque de 300 jeux se lit en 3 appels au lieu de 300 :

```bash
curl -X POST -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"games":[{"platform":"steam","id":"683320"},{"platform":"steam","id":"219150"}]}' \
  https://<achievers>/api/v1/games/lookup
```

Réponse : `items` (les fiches trouvées, dans l'ordre demandé, sans doublon) et `missing` (les
jeux qu'Achievers ne connaît pas, ou les jeux adultes).

Sur la liste des jeux, trois paramètres de plus :

- `sort` : `name`, `completion`, `lastUnlocked` ou `updated`. Sans lui, l'ordre historique est
  conservé — stable d'une page à l'autre, mais sans signification pour le partenaire.
- `status` : `completed` (100 %), `started` (commencé, pas fini) ou `untouched` (0 %).
- `since` : ne rend que les progressions réécrites à partir de cet instant ISO 8601. C'est le
  rattrapage incrémental : on ne relit que ce qui a pu changer.

Le curseur porte l'ordre et la valeur du dernier élément : il se refuse s'il vient d'un autre tri
(`400 bad_request`), comme tout paramètre incompris — plus de valeur remplacée en silence.

Exemple :

```bash
curl -H "Authorization: Bearer ak_…" https://<achievers>/api/v1/games/steam/683320
```

Ce qui ne sort jamais : un profil privé (404), un jeu masqué par le joueur, un jeu adulte, le
nom et la description d'un succès caché tant qu'il n'est pas obtenu. Les textes sont dans la
langue de la plateforme (pas de traduction côté API).

### Routes privées (jeton OAuth du joueur)

| Méthode | Route                                                | Portée                                                                |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| GET     | `/me`                                                | `profile`                                                             |
| GET     | `/me/games`                                          | `library` (même si le profil est privé)                               |
| GET     | `/me/games/{platform}/{platformGameId}/achievements` | `achievements`                                                        |
| GET     | `/me/almost`                                         | `library` : jeux entre 50 et 99 %, pour « finis-le ce soir » sur Lure |

### Webhooks (après l'OAuth)

Les deux se complètent, aucun ne remplace l'autre :

- **Webhooks** pour savoir _quand_ quelque chose change (`achievement.unlocked`,
  `game.completed`) : Lure est prévenu en quelques secondes, sans interroger l'API pour rien.
- **API** pour lire _l'état_ : premier chargement d'un joueur, et rattrapage si un webhook s'est
  perdu (serveur de Lure en panne, déploiement…). Un webhook n'est jamais garanti à 100 %.

Les webhooks viennent après l'OAuth : envoyer à Lure les succès d'un joueur au fil de l'eau
suppose que ce joueur a relié ses comptes et accepté. Chaque envoi est signé HMAC-SHA256 avec un
secret par partenaire, et retenté avec un délai croissant via la file `pg-boss` déjà en place.

### Sécurité et limites

- `/api/v1` sort de la limite par adresse du hook : la limite suit **la clé** (600 requêtes par
  minute), et les clés invalides sont freinées par adresse (30 par minute).
- Appels **serveur à serveur** uniquement : la clé ne doit jamais apparaître dans le navigateur.
  Pas de CORS sur les routes à clé ; `/openapi.json` est ouvert à tous.
- Les règles d'affichage du site s'appliquent : profils privés, jeux masqués, jeux adultes exclus
  par défaut (`visibleGames`, `publicGames`).
- Tests d'intégration (`integration.partner.test.ts`) : clé remplacée ou révoquée refusée,
  profil privé, jeu masqué, jeu adulte, succès caché, pagination, joueurs privés non comptés.

## 5. Dans l'autre sens : ce que Lure pourrait nous offrir

- **Durées de jeu** (« environ 40 h pour le 100 % ») : affichées sur les fiches jeu et les jeux
  presque finis. Récupérées côté serveur, mises en cache 24 h.
- **« Trouver un jeu » contextualisé** : un lien vers Lure qui transmet le jeu ou l'envie, par
  exemple `https://lureverse.fr/trouver?temps=60&envie=finir`.

## 6. Étapes

1. ~~Diapositive Lure et carte de joueur.~~
2. Se mettre d'accord avec le développeur de Lure : ~~identifiants de jeux~~ (appid Steam),
   liste des données, nom de domaine final.
3. ~~Routes publiques `/api/v1` + clé partenaire + OpenAPI.~~
4. Recherche d'identités dans les deux sens + `PartnerLink` : la liaison automatique à la connexion.
5. Achievers fournisseur OAuth (consentement, jetons, révocation, page « Applications reliées »).
6. Routes privées `/me/*`.
7. « Se connecter avec Lure » sur Achievers (quand Lure fournit son OAuth).
8. Webhooks, puis carte en PNG pour Discord (qui n'affiche pas les SVG).

## Questions pour le développeur de Lure

- Quelle est votre pile technique, et existe-t-il déjà un fournisseur OAuth côté Lure ?
- Stockez-vous, pour chaque compte, l'identifiant global du fournisseur (`id` Discord, SteamID64…)
  dans une colonne unique ? C'est tout ce qu'il faut pour la liaison automatique du §2.
- Avez-vous un serveur capable de recevoir des webhooks (une adresse HTTPS publique) ?
- Quelles données voulez-vous afficher sur Lure : la carte seule, la progression, ou le détail
  des succès ?
