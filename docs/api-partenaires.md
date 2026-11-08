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

On s'appuie sur ce qu'Achievers stocke déjà : le couple **(`platform`, `platformGameId`)**, qui
vaut par exemple `STEAM` + `730` pour l'appid Steam. Lure connaît les mêmes identifiants puisqu'il
relie aussi les comptes Steam. `familyKey` regroupe les versions d'un même jeu sur plusieurs
plateformes.

### Routes publiques (clé partenaire, profils publics uniquement)

| Méthode | Route                                 | Contenu                                                                                                   |
| ------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET     | `/users/{handle}`                     | nom, avatar, clan, stats (jeux, succès, cartes par palier, points)                                        |
| GET     | `/users/{handle}/games`               | jeux avec progression : `platform`, `platformGameId`, `completion`, `unlocked`, `total`, `lastUnlockedAt` |
| GET     | `/games/lookup?platform=STEAM&id=730` | fiche Achievers d'un jeu à partir de son identifiant de plateforme                                        |
| GET     | `/games/{slug}`                       | nombre de succès, palier de difficulté, rareté moyenne                                                    |
| GET     | `/users/{handle}/card.svg`            | alias de la carte de joueur                                                                               |

### Routes privées (jeton OAuth du joueur)

| Méthode | Route                                                | Portée                                                                |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| GET     | `/me`                                                | `profile`                                                             |
| GET     | `/me/games`                                          | `library` (même si le profil est privé)                               |
| GET     | `/me/games/{platform}/{platformGameId}/achievements` | `achievements`                                                        |
| GET     | `/me/almost`                                         | `library` : jeux entre 50 et 99 %, pour « finis-le ce soir » sur Lure |

### Plus tard : webhooks

`achievement.unlocked` et `game.completed` envoyés à Lure, signés HMAC-SHA256 avec un secret par
application, nouvelle tentative avec délai croissant via la file `pg-boss` déjà en place.

### Sécurité et limites

- Le hook `limitFor` limite aujourd'hui `/api/*` à 120 requêtes par minute et par adresse. Pour
  `/api/v1`, on limite **par clé ou par jeton** (600/min), pas par adresse, puisque Lure appelle
  depuis un seul serveur.
- Appels **serveur à serveur** recommandés. CORS ouvert seulement pour les routes publiques en
  `GET`, et seulement pour l'origine `https://lureverse.fr`.
- Les règles d'affichage du site s'appliquent : profils privés, jeux masqués, jeux adultes exclus
  par défaut (`visibleGames`, `publicGames`).
- Tests d'intégration pour chaque route : profil privé → 404, jeu masqué absent, portée manquante
  → 403, code réutilisé → refus et révocation de l'autorisation.

## 5. Dans l'autre sens : ce que Lure pourrait nous offrir

- **Durées de jeu** (« environ 40 h pour le 100 % ») : affichées sur les fiches jeu et les jeux
  presque finis. Récupérées côté serveur, mises en cache 24 h.
- **« Trouver un jeu » contextualisé** : un lien vers Lure qui transmet le jeu ou l'envie, par
  exemple `https://lureverse.fr/trouver?temps=60&envie=finir`.

## 6. Étapes

1. ~~Diapositive Lure et carte de joueur.~~
2. Se mettre d'accord avec le développeur de Lure : identifiants de jeux, liste des données,
   appels serveur ou navigateur, nom de domaine final.
3. Routes publiques `/api/v1` + clé partenaire + OpenAPI.
4. Achievers fournisseur OAuth (consentement, jetons, révocation, page « Applications reliées »).
5. Routes privées `/me/*`.
6. « Se connecter avec Lure » sur Achievers (quand Lure fournit son OAuth).
7. Webhooks, puis carte en PNG pour Discord (qui n'affiche pas les SVG).

## Questions pour le développeur de Lure

- Quelle est votre pile technique, et existe-t-il déjà un fournisseur OAuth côté Lure ?
- Vos jeux sont-ils identifiés par appid Steam, IGDB, ou par un identifiant interne ?
- Préférez-vous des appels périodiques ou des webhooks pour les nouveaux succès ?
- Quelles données voulez-vous afficher sur Lure : la carte seule, la progression, ou le détail
  des succès ?
