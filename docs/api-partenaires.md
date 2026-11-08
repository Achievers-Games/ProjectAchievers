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

### Routes publiques — en place

Chaque appel porte la clé : `Authorization: Bearer ak_…`. Les administrateurs la créent, la
remplacent ou la révoquent dans **Modération → Sites partenaires** ; elle ne s'affiche qu'une fois
et seule son empreinte SHA-256 est gardée.

| Méthode | Route                                   | Contenu                                                               |
| ------- | --------------------------------------- | --------------------------------------------------------------------- |
| GET     | `/users/{handle}`                       | nom, avatar, clan, lien de la carte, stats (jeux, succès, cartes…)    |
| GET     | `/users/{handle}/games`                 | jeux et progression, `?platform=steam`, `?limit=` (≤ 100), `?cursor=` |
| GET     | `/users/{handle}/games/{platform}/{id}` | progression d'un jeu et chaque succès, obtenu ou non                  |
| GET     | `/games/{platform}/{id}`                | fiche du jeu, joueurs publics, nombre et taux de 100 %                |
| GET     | `/openapi.json`                         | description OpenAPI 3.1, lisible sans clé                             |

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
4. Achievers fournisseur OAuth (consentement, jetons, révocation, page « Applications reliées »).
5. Routes privées `/me/*`.
6. « Se connecter avec Lure » sur Achievers (quand Lure fournit son OAuth).
7. Webhooks, puis carte en PNG pour Discord (qui n'affiche pas les SVG).

## Questions pour le développeur de Lure

- Quelle est votre pile technique, et existe-t-il déjà un fournisseur OAuth côté Lure ?
- Avez-vous un serveur capable de recevoir des webhooks (une adresse HTTPS publique) ?
- Quelles données voulez-vous afficher sur Lure : la carte seule, la progression, ou le détail
  des succès ?
