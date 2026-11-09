# API partenaires Achievers

Ce guide explique comment ton site peut utiliser Achievers : lire les profils et les jeux, relier
automatiquement les comptes des joueurs, proposer « Se connecter avec Achievers » et recevoir les
nouveaux succès en direct.

- **Adresse** : `https://achievers.games`
- **API** : `https://achievers.games/api/v1`
- **Description OpenAPI 3.1** (lisible sans clé, webhooks compris) :
  `https://achievers.games/api/v1/openapi.json`
- **Devenir partenaire** : écris à [contact@achievers.games](mailto:contact@achievers.games) avec
  le nom et l'adresse de ton site, et ce que tu veux en faire (§1).

## Sommaire

1. [Ce que tu reçois, ce que tu renvoies](#1-ce-que-tu-reçois-ce-que-tu-renvoies)
2. [Règles communes](#2-règles-communes)
3. [Lire les profils et les jeux](#3-lire-les-profils-et-les-jeux)
4. [Relier automatiquement les comptes](#4-relier-automatiquement-les-comptes)
5. [« Se connecter avec Achievers » (OAuth 2)](#5-se-connecter-avec-achievers-oauth-2)
6. [Recevoir les nouveaux succès et les changements de compte (webhooks)](#6-recevoir-les-nouveaux-succès-et-les-changements-de-compte-webhooks)
7. [Liens et cartes sans API](#7-liens-et-cartes-sans-api)

## 1. Ce que tu reçois, ce que tu renvoies

Chaque fonctionnalité est indépendante : prends seulement celles qui te servent.

| Fonctionnalité                            | Tu reçois d'Achievers                              | Tu renvoies à Achievers                                                       |
| ----------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Lire l'API (§3)                           | la clé `ak_…`                                      | rien                                                                          |
| Relier les comptes : ton site → Achievers | la même clé `ak_…`                                 | rien                                                                          |
| Relier les comptes : Achievers → ton site | rien                                               | l'adresse de ton site et une clé que tu crées pour Achievers                  |
| « Se connecter avec Achievers » (§5)      | `client_id` (`ach_…`) et `client_secret` (`acs_…`) | ton adresse de retour, ex. `https://ton-site.example/auth/achievers/callback` |
| Webhooks (§6)                             | un secret de signature `whsec_…`                   | l'adresse HTTPS qui recevra les envois                                        |

Les secrets ne s'affichent qu'une fois chez nous : garde-les côté serveur, jamais dans le
navigateur ni dans un dépôt. Si l'un d'eux fuit, on en génère un nouveau et l'ancien cesse de
valoir aussitôt.

## 2. Règles communes

**Authentification** : chaque appel à `/api/v1` porte la clé, de serveur à serveur :

```http
Authorization: Bearer ak_…
```

Les routes `/me` (§5) prennent un jeton OAuth à la place.

**Format** : JSON, dates ISO 8601 en UTC. Les pourcentages vont de 0 à 100.

**Erreurs** : toujours la même forme, avec un code stable et une phrase pour le développeur.

```json
{ "error": "not_found", "message": "Public profile not found." }
```

| Statut | `error`                           | Quand                                                    |
| ------ | --------------------------------- | -------------------------------------------------------- |
| 400    | `bad_request`, `unknown_platform` | paramètre invalide (il n'est jamais remplacé en silence) |
| 401    | `unauthorized`                    | clé absente, inconnue ou révoquée                        |
| 404    | `not_found`                       | joueur inconnu ou privé, jeu inconnu ou adulte           |
| 429    | `rate_limited`                    | trop de requêtes : attendre `Retry-After` secondes       |

**Limites** : 600 requêtes par minute et par clé. Les réponses se gardent en cache 5 minutes.

**Ce qui ne sort jamais** : un profil privé, un jeu que le joueur a masqué, un jeu adulte, le
nom et la description d'un succès caché tant qu'il n'est pas obtenu, le temps de jeu d'un joueur.
Les textes des succès sont en **français**, la langue du site, quand la plateforme la fournit ;
sinon dans la langue de la plateforme.

**Identifier un joueur** : garde son `id` Achievers. Il ne change jamais, alors que le `handle`
(l'adresse `/u/{handle}`) peut changer. Toutes les routes `/users/{handle}…` acceptent l'un ou
l'autre : `/users/exemple` et `/users/cmv0…` rendent le même profil.

**Avatar** : `avatarUrl` est toujours une adresse `https://`, ou `null` si le joueur n'a pas
d'image.

**Identifier un jeu** : `platform` + `platformGameId`. Pour Steam, `platformGameId` est l'**appid**,
l'identifiant utilisé par la plupart des sites de jeux : `/games/steam/683320`. Plateformes :
`steam`, `psn`, `xbox`, `retro`, `blizzard`.

Chaque jeu porte aussi `steamAppId` : l'appid Steam du même jeu, y compris pour une version PSN ou
Xbox quand il existe sur Steam (`null` sinon). Un 100 % sur PS5 se range ainsi sur la bonne fiche
de ton site.

## 3. Lire les profils et les jeux

| Méthode | Route                                   | Contenu                                                           |
| ------- | --------------------------------------- | ----------------------------------------------------------------- |
| GET     | `/users/{handle}`                       | profil, clan, statistiques, liens de la carte                     |
| GET     | `/users/{handle}/games`                 | jeux et progression, paginés                                      |
| GET     | `/users/{handle}/games/{platform}/{id}` | progression d'un jeu, succès par succès                           |
| GET     | `/users/{handle}/almost`                | jeux commencés les plus proches du 100 %                          |
| GET     | `/games/{platform}/{id}`                | fiche d'un jeu et ce que coûte son 100 %                          |
| POST    | `/games/lookup`                         | jusqu'à 100 fiches de jeux en un appel                            |
| GET     | `/games/{platform}/{id}/achievements`   | les succès d'un jeu sans joueur, avec le lien de leurs guides     |
| POST    | `/users/lookup`                         | jusqu'à 100 joueurs en un appel, avec leur progression sur un jeu |
| GET     | `/games/popular`                        | jeux où les chasseurs de succès sont actifs                       |
| GET     | `/completions/recent`                   | les derniers 100 % des joueurs publics                            |

### Un joueur

```bash
curl -H "Authorization: Bearer ak_…" https://achievers.games/api/v1/users/exemple
```

```json
{
  "id": "cmv0…",
  "handle": "exemple",
  "displayName": "LaKokilletteCendrée",
  "isPublic": true,
  "avatarUrl": "https://…",
  "url": "https://achievers.games/u/exemple",
  "cardUrl": "https://achievers.games/u/exemple/carte.svg",
  "cardPngUrl": "https://achievers.games/u/exemple/carte.png",
  "memberSince": "2026-10-01T18:00:00.000Z",
  "clan": {
    "name": "Achievers",
    "slug": "achievers",
    "url": "https://achievers.games/clans/achievers"
  },
  "stats": {
    "games": 976,
    "achievements": 11437,
    "cards": 34,
    "cardsByTier": [20, 8, 3, 2, 1, 0],
    "points": 4675
  }
}
```

`cards` compte les jeux finis à 100 % ; `cardsByTier` les répartit par difficulté, de Bronze à
Légendaire.

### Ses jeux

`GET /users/{handle}/games`, paramètres facultatifs :

| Paramètre  | Valeurs                                                      |
| ---------- | ------------------------------------------------------------ |
| `platform` | `steam`, `psn`, `xbox`, `retro`, `blizzard`                  |
| `status`   | `completed` (100 %), `started` (commencé), `untouched` (0 %) |
| `sort`     | `name`, `completion`, `lastUnlocked`, `updated`              |
| `since`    | date ISO : seulement les progressions modifiées depuis       |
| `limit`    | 1 à 100 (50 par défaut)                                      |
| `cursor`   | le `nextCursor` de la page précédente                        |

```json
{
  "items": [
    {
      "game": {
        "platform": "steam",
        "platformGameId": "219150",
        "console": null,
        "slug": "hotline-miami",
        "name": "Hotline Miami",
        "url": "https://achievers.games/jeux/hotline-miami",
        "coverUrl": "https://…",
        "headerUrl": "https://…",
        "totalAchievements": 35,
        "tier": 4,
        "tags": [1774, 492],
        "familyKey": "hotline miami",
        "steamAppId": "219150"
      },
      "progress": {
        "unlocked": 34,
        "total": 35,
        "completion": 97.1,
        "completed": false,
        "platinum": false,
        "lastUnlockedAt": "2026-11-08T20:00:00.000Z",
        "updatedAt": "2026-11-08T20:01:12.000Z"
      }
    }
  ],
  "nextCursor": "k1.…"
}
```

Pour tout lire, rappelle la route avec `cursor=<nextCursor>` jusqu'à ce qu'il vaille `null`, en
gardant les mêmes `sort` et `status`. Pour une resynchronisation, `since=<date du dernier passage>`
ne rend que ce qui a changé.

### Un jeu, succès par succès

`GET /users/{handle}/games/steam/219150` rend `game`, `progress` et `achievements` :

```json
{
  "id": "ACH_COMBO_KING",
  "name": "Combo King",
  "description": "Perform a 12x combo",
  "iconUrl": "https://…",
  "hidden": false,
  "trophyType": "achievement",
  "rarity": 10.3,
  "points": 10,
  "missable": false,
  "unlocked": true,
  "unlockedAt": "2026-11-08T20:00:00.000Z"
}
```

`rarity` est le pourcentage de joueurs qui l'ont. `missable` : le succès peut se perdre pour la
partie en cours. `trophyType` vaut `platinum`, `gold`, `silver` ou `bronze` sur PlayStation.

### « Finis-le ce soir »

`GET /users/{handle}/almost?limit=10` (1 à 50) rend les jeux commencés, du plus proche du 100 % au
plus lointain, avec ce qui reste :

```json
{
  "game": { "…": "…" },
  "progress": { "…": "…" },
  "remaining": {
    "achievements": 1,
    "hardestRarity": 10.3,
    "easiestRarity": 10.3,
    "missable": 0,
    "points": 10
  }
}
```

Les noms des succès restants ne sont pas donnés, pour qu'un succès caché reste secret. Le détail
est dans la route « un jeu, succès par succès ».

### La fiche d'un jeu et le coût de son 100 %

`GET /games/steam/219150` rend les champs du jeu, plus :

```json
{
  "players": 2,
  "completions": 1,
  "completionRate": 50,
  "difficulty": { "missableAchievements": 0, "missablesReviewed": true, "rarestAchievement": 4 },
  "guides": {
    "achievementsCovered": 35,
    "gameGuides": 0,
    "bestGameGuideUrl": null
  },
  "completionTime": { "medianMinutes": 840, "sample": 12 }
}
```

- `players`, `completions`, `completionRate` : joueurs publics d'Achievers qui ont le jeu, et
  combien l'ont fini à 100 %.
- `missableAchievements` : succès qui peuvent se perdre pour la partie en cours.
  `missablesReviewed` vaut `true` quand un guide officiel a relevé tous les succès : le compte est
  alors complet. Sinon, il ne contient que les manquables déjà connus.
- `rarestAchievement` : pourcentage de joueurs qui ont le succès le plus rare.
- `guides` : succès couverts par au moins un guide, guides complets du jeu, et le lien du
  meilleur (l'officiel d'abord, sinon le mieux noté par la communauté).
- `completionTime` : temps de jeu Steam **médian** des joueurs publics à 100 %, et sur combien de
  joueurs. `null` sous cinq joueurs, et pour les jeux hors Steam. À afficher comme « environ ».

De quoi annoncer, par exemple : « 100 % accessible : aucun succès manquable, guide disponible,
environ 14 h ».

### Plusieurs jeux d'un coup

Pour enrichir une bibliothèque : 100 jeux par appel, donc 3 appels pour 300 jeux.

```bash
curl -X POST https://achievers.games/api/v1/games/lookup \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"games":[{"platform":"steam","id":"219150"},{"platform":"steam","id":"999999999"}]}'
```

```json
{
  "items": [{ "platform": "steam", "platformGameId": "219150", "…": "même fiche que ci-dessus" }],
  "missing": [{ "platform": "steam", "id": "999999999" }]
}
```

`items` suit l'ordre de la demande, sans doublon. `missing` liste les jeux qu'Achievers ne connaît
pas encore, ou les jeux adultes.

### Les succès d'un jeu, sans joueur

`GET /games/steam/219150/achievements` rend `game` et ses `achievements`, du plus rare au plus
courant : les mêmes champs que pour un joueur (sans `unlocked` ni `unlockedAt`), plus
`guideUrl`, la page du succès avec ses guides, ou `null` s'il n'en a pas. Un succès caché garde
son nom et sa description à `null`. De quoi afficher sur ta fiche de jeu les succès les plus rares,
les manquables à surveiller et les guides.

### Plusieurs joueurs d'un coup

Pour les cartes de tous les amis d'un joueur : 100 joueurs par appel, par handle ou par `id`.

```bash
curl -X POST https://achievers.games/api/v1/users/lookup \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"users":["exemple","cmv1…"],"game":"steam:219150"}'
```

`items` suit l'ordre de la demande, sans doublon, avec le même profil que `/users/{handle}`.
`missing` liste les comptes inconnus ou privés. Avec `game`, chaque profil porte en plus
`gameProgress` sur ce jeu, `null` si le joueur ne l'a pas : « 3 de tes amis l'ont fini à
100 % ».

### Les jeux du moment

`GET /games/popular?period=week` (ou `month`), `limit` de 1 à 50 (20 par défaut) :

```json
{
  "period": "week",
  "since": "2026-11-01T20:00:00.000Z",
  "items": [{ "game": { "…": "fiche du jeu" }, "periodCompletions": 5, "activePlayers": 18 }]
}
```

Classés par nombre de 100 % atteints sur la période, puis par nombre de joueurs actifs.

### Les derniers 100 %

`GET /completions/recent`, `limit` de 1 à 50 (20 par défaut), et `since` (date ISO) pour ne
garder que les 100 % plus récents : un fil « ça vient de tomber » pour ta page d'accueil.

```json
{
  "items": [
    {
      "completedAt": "2026-11-09T18:42:00.000Z",
      "platinum": false,
      "user": {
        "id": "cmv0…",
        "handle": "exemple",
        "displayName": "Kokki",
        "avatarUrl": "https://…",
        "url": "https://achievers.games/u/exemple"
      },
      "game": { "…": "fiche du jeu" },
      "card": { "tier": 3, "rank": "gold" }
    }
  ]
}
```

Du plus récent au plus ancien, seulement les joueurs publics. `card` est la carte gagnée : son
palier (1 à 6 : `bronze`, `silver`, `gold`, `diamond`, `prismatic`, `legendary`) dit la
difficulté du jeu.

## 4. Relier automatiquement les comptes

Quand un joueur se connecte des deux côtés avec le même compte Steam (ou Discord, Google…), c'est
la même personne : Steam renvoie le même identifiant aux deux sites. Aucun des deux n'a à croire
l'autre sur parole, et on ne compare jamais d'e-mail ni de pseudo.

**Ce que ton site doit stocker** : pour chaque compte, l'identifiant brut que renvoie le fournisseur.

| Fournisseur | `provider` | `providerUserId`                  |
| ----------- | ---------- | --------------------------------- |
| Steam       | `STEAM`    | SteamID64 (`76561198000000000`)   |
| Discord     | `DISCORD`  | `id` de l'utilisateur (snowflake) |
| Google      | `GOOGLE`   | `sub`                             |
| Xbox        | `XBOX`     | XUID                              |
| Epic        | `EPIC`     | `sub`                             |
| Battle.net  | `BLIZZARD` | `sub`                             |

### Ton site → Achievers

Quand un joueur se connecte sur ton site, envoie **toutes** ses identités, pas seulement celle de la
connexion :

```bash
curl -X POST https://achievers.games/api/v1/partner/identities/lookup \
  -H "Authorization: Bearer ak_…" -H "Content-Type: application/json" \
  -d '{"identities":[{"provider":"STEAM","providerUserId":"76561198000000000"}]}'
```

```json
{ "partnerUserIds": ["cmv0…"] }
```

Ce sont les `id` Achievers trouvés : un seul, c'est le compte à relier. Aucun, rien à faire.
Plusieurs (Steam mène à un compte, Discord à un autre), ne relie pas automatiquement et laisse le
joueur choisir. De 1 à 20 identités par appel. La réponse ne contient jamais de nom ni de donnée de
profil.

### Achievers → ton site (sur demande)

À chaque connexion sur Achievers, Achievers peut faire l'appel inverse. Pour l'activer, ton site
expose le **même** point d'entrée et nous donne son adresse et une clé :

- `POST https://ton-site.example/api/v1/partner/identities/lookup`
- en-tête `Authorization: Bearer <la clé que tu as créée pour Achievers>`
- corps `{"identities":[{"provider":"STEAM","providerUserId":"…"}]}`, `provider` en majuscules
- réponse `{"partnerUserIds":["<id du compte chez toi>"]}`, liste vide si aucun

Achievers attend au plus 2 secondes : une panne de ton site n'empêche jamais de se connecter, le
lien se fera simplement plus tard. S'il trouve exactement un compte, il garde son identifiant, et
c'est lui qui revient dans les webhooks (`user.partnerUserId`). Le joueur peut délier depuis son
compte Achievers ; le lien n'est alors plus recréé automatiquement.

## 5. « Se connecter avec Achievers » (OAuth 2)

Pour un bouton « Se connecter avec Achievers », et pour lire les données d'un joueur **même si son
profil est privé**, avec son accord. Le flux est le code d'autorisation avec **PKCE S256
obligatoire** ; ton site est un client confidentiel (le secret reste sur le serveur).

**Portées** :

| Portée         | Donne accès à                                       |
| -------------- | --------------------------------------------------- |
| `profile`      | nom, avatar, clan, statistiques ; toujours accordée |
| `library`      | jeux et progression, même au profil privé           |
| `achievements` | le détail des succès, jeu par jeu                   |

### Le parcours

1. **Préparer** : générer un `code_verifier` aléatoire de 43 à 128 caractères, le
   `code_challenge` = base64url(SHA-256(`code_verifier`)), et un `state` aléatoire, gardés dans la
   session du joueur.

   ```js
   import { createHash, randomBytes } from 'node:crypto';
   const verifier = randomBytes(32).toString('base64url');
   const challenge = createHash('sha256').update(verifier).digest('base64url');
   const state = randomBytes(16).toString('base64url');
   ```

2. **Envoyer le joueur** sur la page d'accord :

   ```
   https://achievers.games/oauth/authorize
     ?response_type=code
     &client_id=ach_…
     &redirect_uri=https://ton-site.example/auth/achievers/callback
     &scope=library%20achievements
     &state=<state>
     &code_challenge=<challenge>
     &code_challenge_method=S256
   ```

   Il se connecte si besoin, voit ce que ton site pourra lire et accepte. S'il a déjà accepté les
   mêmes portées, il revient aussitôt, sans écran. `redirect_uri` doit être exactement celle
   déclarée chez nous.

3. **Au retour** sur ton adresse : vérifie que `state` est le tien. Tu reçois `?code=ac_…`, ou
   `?error=access_denied` si le joueur a refusé.

4. **Échanger le code**, en JSON (pas en formulaire : notre protection CSRF refuse les formulaires
   venus d'un autre site). Le code est valable 10 minutes, une seule fois.

   ```bash
   curl -X POST https://achievers.games/oauth/token -H "Content-Type: application/json" -d '{
     "grant_type": "authorization_code",
     "client_id": "ach_…",
     "client_secret": "acs_…",
     "code": "ac_…",
     "code_verifier": "<verifier>",
     "redirect_uri": "https://ton-site.example/auth/achievers/callback"
   }'
   ```

   ```json
   {
     "access_token": "at_…",
     "token_type": "Bearer",
     "expires_in": 3600,
     "refresh_token": "rt_…",
     "scope": "profile library achievements"
   }
   ```

5. **Lire** avec `Authorization: Bearer at_…` :

   | Route                                  | Portée         | Même réponse que                          |
   | -------------------------------------- | -------------- | ----------------------------------------- |
   | `GET /api/v1/me`                       | `profile`      | `/users/{handle}`                         |
   | `GET /api/v1/me/games`                 | `library`      | `/users/{handle}/games`, mêmes paramètres |
   | `GET /api/v1/me/games/{platform}/{id}` | `achievements` | `/users/{handle}/games/{platform}/{id}`   |
   | `GET /api/v1/me/almost`                | `library`      | `/users/{handle}/almost`                  |

   `GET /me` donne l'`id` Achievers du joueur : c'est lui qu'il faut garder pour relier le compte
   chez toi. Un jeton expiré ou retiré répond `401 invalid_token` ; une portée manquante,
   `403 insufficient_scope`.

6. **Rafraîchir** avant l'heure, sur le même point d'entrée :

   ```json
   {
     "grant_type": "refresh_token",
     "client_id": "ach_…",
     "client_secret": "acs_…",
     "refresh_token": "rt_…"
   }
   ```

   Tu reçois une **nouvelle paire** : garde le nouveau `refresh_token`, l'ancien ne sert plus.
   Un jeton de rafraîchissement vaut 60 jours.

7. **Déconnecter** : `POST https://achievers.games/oauth/revoke`, en JSON,
   `{"client_id", "client_secret", "token"}`. Révoquer le `refresh_token` coupe tout l'accès.

**Sécurité** : un code ou un jeton de rafraîchissement présenté **deux fois** coupe tout l'accès
du joueur, car c'est le signe d'un vol. Ne rejoue donc jamais une requête de jeton sans relire la
réponse. Le joueur peut aussi retirer l'accès à tout moment depuis son compte Achievers : la
prochaine requête répond `401`, et il faut lui reproposer de se connecter.

## 6. Recevoir les nouveaux succès et les changements de compte (webhooks)

Achievers prévient ton site dans la minute quand un joueur suivi débloque un succès, et quand un
compte est relié, délié ou modifié. C'est le
complément de l'API : les webhooks disent **quand** ça change, l'API donne **l'état** (premier
chargement, rattrapage après une panne).

**Joueurs suivis** :

- ceux reliés automatiquement (§4) dont le profil est public ;
- ceux qui ont autorisé ton site avec la portée `library` (§5), même au profil privé.

Rien ne part pour un jeu masqué par le joueur ni pour un jeu adulte. Au premier branchement, les
envois partent du moment présent : l'historique n'est pas renvoyé, utilise l'API pour lui.

**L'envoi** : un `POST` JSON sur ton adresse, au plus une fois par minute, regroupant jusqu'à 500
succès, un événement par joueur et par jeu.

```http
POST /api/achievers/webhook HTTP/1.1
Content-Type: application/json
User-Agent: Achievers-Webhooks/1
X-Achievers-Signature: t=1794168000,v1=5f2c…
```

```json
{
  "events": [
    {
      "id": "0b6f7c1e-…",
      "type": "achievements.unlocked",
      "at": "2026-11-08T20:00:30.000Z",
      "user": {
        "id": "cmv0…",
        "handle": "exemple",
        "isPublic": true,
        "avatarUrl": "https://…",
        "partnerUserId": "id-du-compte-chez-toi"
      },
      "game": {
        "platform": "steam",
        "platformGameId": "219150",
        "name": "Hotline Miami",
        "steamAppId": "219150"
      },
      "achievements": [
        { "id": "ACH_COMBO_KING", "name": "Combo King", "unlockedAt": "2026-11-08T20:00:00.000Z" }
      ],
      "progress": { "unlocked": 34, "total": 35, "completion": 97.1, "completed": false }
    }
  ]
}
```

- `type` vaut `game.completed` quand ces succès font passer le jeu à 100 %, sinon
  `achievements.unlocked`.
- `game.steamAppId` est l'appid Steam du jeu, même pour un 100 % sur PS5 ou Xbox quand le jeu
  existe aussi sur Steam ; `null` sinon.

**Annonces** : en plus de l'événement du jeu, dans le même envoi.

| `type`             | Quand                                                                   |
| ------------------ | ----------------------------------------------------------------------- |
| `card.earned`      | le jeu vient de passer à 100 % : la carte gagnée, `card.tier` et `rank` |
| `achievement.rare` | un succès débloqué par moins de 1 % des joueurs : un par succès         |

```json
{
  "id": "4c1d…",
  "type": "achievement.rare",
  "at": "2026-11-08T20:00:30.000Z",
  "user": { "…": "comme plus haut" },
  "game": { "…": "comme plus haut" },
  "achievement": {
    "id": "ACH_COMBO_KING",
    "name": "Combo King",
    "rarity": 0.4,
    "unlockedAt": "2026-11-08T20:00:00.000Z"
  }
}
```

`card.earned` porte `"card": { "tier": 3, "rank": "gold" }` à la place de `achievement`.

- `user.partnerUserId` est l'identifiant du compte chez toi si les comptes sont reliés
  automatiquement ; `null` pour un joueur venu seulement par OAuth : retrouve-le par `user.id`.
- `at` est le moment où Achievers a appris le changement.

**Changements de compte** : dans le même envoi, avec la même forme de `user`.

| `type`          | Quand                                                                        |
| --------------- | ---------------------------------------------------------------------------- |
| `user.linked`   | un compte vient d'être relié : liaison automatique, ou premier accord OAuth  |
| `user.unlinked` | le joueur a délié ton site, ou retiré son accès, depuis son compte Achievers |
| `user.updated`  | le handle ou l'avatar a changé, ou le profil est passé public ou privé       |

```json
{
  "id": "cmw9…",
  "type": "user.linked",
  "at": "2026-11-09T08:00:00.000Z",
  "via": "auto",
  "user": {
    "id": "cmv0…",
    "handle": "exemple",
    "isPublic": true,
    "avatarUrl": "https://…",
    "partnerUserId": "id-du-compte-chez-toi"
  }
}
```

- `via` vaut `auto` (identités communes, §4) ou `oauth` (« Se connecter avec Achievers », §5) ;
  il n'y en a pas pour `user.updated`.
- Pour `user.unlinked`, `partnerUserId` donne le compte qui vient d'être délié.
- `user.updated` décrit toujours l'**état actuel** : plusieurs changements rapprochés n'en
  donnent qu'un.

**Vérifier la signature** avant tout traitement. `X-Achievers-Signature` porte un HMAC-SHA256 de
`"<t>.<corps brut>"` avec le secret `whsec_…`. Calcule-le sur le **corps brut**, avant de parser
le JSON :

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, header, secret) {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) return false;
  const [, t, v1] = match;
  // Plus de 5 minutes : un ancien envoi rejoué, on refuse.
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
}
```

**Répondre** `2xx` rapidement, puis traiter. Sans `2xx`, Achievers renvoie le même lot après
1 minute, puis 2, 4… jusqu'à 1 heure entre deux essais. Un événement renvoyé garde **le même
`id`** : ignore simplement un `id` déjà traité.

## 7. Liens et cartes sans API

Rien de tout ceci ne demande de clé.

**Lien vers un jeu par son appid** : `https://achievers.games/jeux/steam/683320` redirige vers la
fiche du jeu sur Achievers, en gardant les paramètres (`?utm_source=lure`). Même forme pour
`psn`, `xbox`, `retro` et `blizzard`. Pratique pour un lien « Voir les succès sur Achievers » sur
chaque fiche de jeu.

**Carte de joueur** à intégrer comme une image, en SVG (600×180) ou en PNG (1200×360, qui
s'affiche aussi sur Discord) :

```html
<img
  src="https://achievers.games/u/exemple/carte.svg"
  width="600"
  height="180"
  alt="Carte Achievers d'exemple"
/>
```

Un profil privé répond `404`. Les liens exacts sont aussi dans `cardUrl` et `cardPngUrl` (§3).
