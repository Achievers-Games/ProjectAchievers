# Project Achievers

Site web communautaire pour les chasseurs de succès : la progression se synchronise automatiquement depuis Steam, Discord, Google, Xbox, PlayStation, RetroAchievements, Epic et Blizzard, avec profils publics, comparaison, classement, guides et discussions.

## Stack

| Couche          | Choix                                                     |
| --------------- | --------------------------------------------------------- |
| Application     | SvelteKit 2, Svelte 5, `adapter-node`                     |
| Base de données | PostgreSQL, Prisma                                        |
| Synchronisation | File de tâches pg-boss, progression en Server-Sent Events |
| Style           | Tailwind, tokens CSS dans `src/app.css`                   |
| Tests           | Vitest (intégration sur Postgres réel), Playwright        |

## Démarrer

Node 22 ou plus est requis. Copie `.env.example` vers `.env` et remplis `ENCRYPTION_KEY` avec 32 octets en hexadécimal :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Puis :

```bash
npm install
npm run dev:db
```

Dans un second terminal :

```bash
npx prisma migrate deploy
npm run dev
```

`npm run dev:db` lance un PostgreSQL local sans Docker, sur le port 5433. Le site est sur
<http://localhost:3000>.

## Vérifier

```bash
npm run check
npm run lint
npm test
npm run test:e2e
```

`npm test` et `npm run test:e2e` recréent une base séparée, `achievers_test`, avec des données de
démonstration. La base de développement ne contient que de vraies données, et le serveur peut rester
allumé pendant les tests.

## Comptes de jeu

Un fournisseur sans configuration est simplement masqué ou indiqué comme non activé.

| Compte            | Connexion                          | Configuration                                  | Redirection à déclarer            |
| ----------------- | ---------------------------------- | ---------------------------------------------- | --------------------------------- |
| Steam             | OpenID                             | `STEAM_API_KEY`                                | aucune                            |
| Discord           | OAuth 2 + PKCE                     | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`   | `{ORIGIN}/auth/discord/callback`  |
| Google            | OpenID Connect + PKCE              | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`     | `{ORIGIN}/auth/google/callback`   |
| Xbox              | Microsoft Entra + PKCE             | `XBOX_CLIENT_ID`, `XBOX_CLIENT_SECRET`         | `{ORIGIN}/auth/xbox/callback`     |
| PlayStation       | Identifiant PSN + code dans la bio | `PSN_SERVICE_NPSSO`                            | aucune                            |
| RetroAchievements | OpenID                             | `RETRO_API_KEY`                                | aucune                            |
| Epic              | OAuth 2 + PKCE                     | `EPIC_CLIENT_ID`, `EPIC_CLIENT_SECRET`         | `{ORIGIN}/auth/epic/callback`     |
| Blizzard          | OAuth 2                            | `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET` | `{ORIGIN}/auth/blizzard/callback` |

Les comptes se synchronisent à la liaison, puis automatiquement toutes les 24 heures.

Les visites déclenchent aussi une synchronisation plus fréquente. Sur Steam, les jeux récents
sont relus même si leur temps de jeu n'a pas changé ; les autres sont revérifiés au moins toutes
les 24 heures lors d'une synchronisation. Le bouton d'actualisation force cette relecture sans
attendre. Seule une lecture réussie des succès repousse la prochaine vérification.

**Un profil, plusieurs comptes** : chaque compte lié ouvre le même profil. Lier un compte qui
appartient déjà à un autre profil propose de fusionner les deux, après confirmation. Un e-mail ou un
pseudo identique ne rattache jamais rien automatiquement.

**PlayStation** : Sony n'a pas d'API publique. Le site passe par l'API non officielle via `psn-api`
et un compte de service dédié, jamais par le NPSSO d'un joueur. Le joueur prouve qu'il possède le
profil avec un code temporaire dans sa bio. Ses trophées doivent être publics. Le NPSSO du compte de
service expire et doit être renouvelé à la main.

**Xbox** : l'application Entra doit accepter les comptes Microsoft personnels. Microsoft peut exiger
une approbation pour l'accès à Xbox Live.

## Déployer

```bash
docker compose up -d --build
```

`docker-compose.yml` lit `POSTGRES_PASSWORD`, `ORIGIN`, `ENCRYPTION_KEY` et les clés des fournisseurs.
Les migrations s'appliquent au démarrage. Le serveur écoute sur le port 3000 et doit rester derrière
un proxy HTTPS. S'il est le seul proxy devant le site, définis aussi `ADDRESS_HEADER=X-Forwarded-For`
et `XFF_DEPTH=1` pour que les limites de débit voient la vraie adresse des visiteurs.

Le site tourne en **un seul processus** : limites de débit et événements temps réel vivent en mémoire.

### Rareté des cartes

Toutes les versions d'une même famille de jeux partagent une rareté. Le calcul prend le taux
du succès le plus rare de chaque liste, moyenne les listes d'une même plateforme, puis moyenne
les plateformes à poids égal. Les taux absents, nuls ou hors de 0–100 % sont exclus. S'il n'existe
aucun taux exploitable, le nombre moyen de succès par plateforme sert de recours. Les seuils
Bronze à Légendaire restent ceux de `src/lib/collection.ts`.

La rareté évolue avec les données de synchronisation, indépendamment des comptes liés par le
joueur. Terminer d'autres versions ajoute des exemplaires ×2, ×3 puis ×4 ; chaque jeu ne compte
qu'une fois au classement des collections. La modération peut séparer les éditions non
équivalentes : le calcul recalcule alors les deux familles.

Sur le TS-233, le budget est limité à un traitement lourd à la fois : imports, suivi Steam en
direct et maintenance partagent `BACKGROUND_CONCURRENCY=1`. Les imports passent avant la maintenance
en attente ; le balayage Steam libère ce budget entre ses pages de 1 000 jeux. Les concurrences
`SYNC_CONCURRENCY`, `SYNC_GAME_CONCURRENCY` et `STEAM_CONCURRENCY` valent aussi `1` sur le NAS.
`BLIZZARD_DETAILS_PER_RUN=50` borne le remplissage horaire des détails WoW.

Les logs `Charge serveur` indiquent la mémoire au début et à la fin des tâches, leur durée, puis
toutes les minutes le tas JavaScript, la mémoire résidente et le retard de la boucle Node. Le
niveau passe à `warn` au-delà de 80 % du tas ou d'une seconde de retard. La limite mémoire du
conteneur reste à 512 Mo et celle du tas à 320 Mo : ces mesures servent à vérifier les pics après
déploiement, avant d'envisager un worker séparé et son budget mémoire supplémentaire.

L'accueil, le classement, la saison et le classement global de la communauté partagent un cache
mémoire public de 15 secondes, limité à douze clés. Les écritures qui touchent des données
publiques, les synchronisations et les recalculs de rareté l'invalident ; les données
personnelles restent lues par requête. La bannière de progression utilise une requête dédiée
qui ne renvoie qu'un jeu. Après une synchro, les relectures ciblent `app:sync` et regroupent les
événements rapprochés. Les animations de cartes sont suspendues hors écran et dans les onglets
masqués. L'en-tête `Server-Timing` mesure la durée des pages ; les rendus dépassant 500 ms sont
journalisés avec leur route, sans paramètres ni identité du visiteur.

### Formulaire de contact et email

`/contact` envoie chaque message par SMTP à `CONTACT_INBOX` (par défaut `SMTP_FROM`) avec l'adresse
du visiteur en `Reply-To`, pour pouvoir répondre directement. Trois messages par heure et par IP,
plus un champ piège contre les robots. Sans configuration SMTP, la page invite à écrire directement à
`contact@achievers.games`.

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=contact@achievers.games
SMTP_PASS=mot-de-passe-application
SMTP_FROM=contact@achievers.games
SMTP_FROM_NAME=Project Achievers
CONTACT_INBOX=contact@achievers.games
```

Avec Gmail, `SMTP_PASS` est un **mot de passe d'application** (compte Google avec validation en deux
étapes), pas le mot de passe du compte. Sur le NAS, `bash scripts/nas-smtp.sh` écrit ces valeurs dans
le `.env`.

### Déjà prêt pour l'ouverture publique

✅ `src/routes/confidentialite` est complet — toutes les sections (données, droits, traduction, etc.) sont traduites en 8 langues et affichent l'identité de l'éditeur (`contact@achievers.games`).

✅ Sauvegardes quotidiennes — sur le NAS, **Hybrid Backup Sync 3 (HBS 3)** écrit vers votre Google Drive ; 14 derniers dump sont conservés et restaurables avec `pg_restore`.

✅ Rôle moderator — votre compte `Basic` dispose déjà du rôle `MODERATOR` pour accéder à `/moderation`.

### Sur le NAS

La production tourne sur un QNAP TS-233 avec `docker-compose.nas.yml`, exposée par Cloudflare Tunnel
sans port ouvert. Le code, le fichier `.env` et les sauvegardes sont dans
`/share/CACHEDEV1_DATA/project-achievers`.

La CI publie une image ARM64 pour chaque commit de `main` qui passe les tests, et le NAS la tire
lui-même : le service `deployer` de `docker-compose.nas.yml` interroge le registre toutes les trois
minutes et redémarre le site quand l'image `latest` change. Un commit de `main` validé par la CI est
donc en ligne quelques minutes plus tard, sans intervention.

Pour mettre en ligne à la main — nécessaire pour un changement de ce fichier compose ou du `.env`,
que le déploiement automatique ne transporte pas — avec la clé SSH `~/.ssh/pa_nas` :

```bash
bash scripts/deploy-nas.sh
```

Le NAS doit avoir été autorisé une fois avec un jeton GitHub `read:packages`, par
`bash scripts/nas-ghcr-login.sh`. Pour tester du code non commité, ou si GitHub est indisponible,
`NAS_BUILD=1 bash scripts/deploy-nas.sh <ref>` reconstruit l'image sur le NAS.

`bash scripts/deploy-nas.sh <sha>` épingle une image plus ancienne : c'est le retour en arrière, que
le prochain commit de `main` remplacera. Pour suspendre le déploiement automatique sur le NAS :
`docker compose -f docker-compose.nas.yml --profile tunnel stop deployer`.

Une sauvegarde de la base est écrite chaque jour dans `backups/`, 14 jours sont conservés. Sur le NAS,
c'est **Hybrid Backup Sync 3 (HBS 3)** qui écrit vers votre Google Drive : les 14 derniers dump sont
conservés et peuvent être restaurés avec la commande `pg_restore` indiquée ci‑dessous.

```bash
docker exec -i project-achievers-db-1 pg_restore -U achievers -d achievers --clean --if-exists < backups/achievers-AAAA-MM-JJ.dump
```

## Structure

```
prisma/                    Schéma et migrations
src/hooks.server.ts        Sessions, limites de débit, en-têtes, démarrage des tâches
src/lib/server/providers/  Authentification Steam, Discord, Google, Xbox, PSN, Retro, Epic, Blizzard
src/lib/server/sync/       Synchronisation par plateforme et file de tâches
src/lib/server/queries.ts  Lectures partagées entre les pages
src/routes/                Pages et points d'accès
e2e/                       Tests Playwright
```
