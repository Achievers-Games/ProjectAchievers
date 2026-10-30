# Project Achievers

Site web communautaire pour les chasseurs de succès : la progression Steam, PlayStation et Xbox se
synchronise automatiquement, avec profils publics, comparaison, classement, guides et discussions.

## Stack

| Couche          | Choix                                                     |
| --------------- | --------------------------------------------------------- |
| Application     | SvelteKit 2, Svelte 5, `adapter-node`                     |
| Base de données | PostgreSQL, Prisma                                        |
| Synchronisation | File de tâches pg-boss, progression en Server-Sent Events |
| Style           | Tailwind, tokens CSS dans `src/app.css`                   |
| Tests           | Vitest (intégration sur Postgres réel), Playwright        |

## Démarrer

Node 20 ou plus est requis. Copie `.env.example` vers `.env`, génère `ENCRYPTION_KEY`, puis :

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
<http://localhost:5173>.

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

| Compte      | Connexion                          | Configuration                                | Redirection à déclarer           |
| ----------- | ---------------------------------- | -------------------------------------------- | -------------------------------- |
| Steam       | OpenID                             | `STEAM_API_KEY`                              | aucune                           |
| Discord     | OAuth 2 + PKCE                     | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | `{ORIGIN}/auth/discord/callback` |
| Google      | OpenID Connect + PKCE              | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | `{ORIGIN}/auth/google/callback`  |
| Xbox        | Microsoft Entra + PKCE             | `XBOX_CLIENT_ID`, `XBOX_CLIENT_SECRET`       | `{ORIGIN}/auth/xbox/callback`    |
| PlayStation | Identifiant PSN + code dans la bio | `PSN_SERVICE_NPSSO`                          | aucune                           |

Les comptes se synchronisent à la liaison, puis automatiquement toutes les 24 heures.

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

Avant une ouverture publique :

- complète `src/routes/confidentialite` avec l'identité de l'éditeur ;
- prévois des sauvegardes de la base ;
- donne le rôle `MODERATOR` ou `ADMIN` à un compte, dans la table `User`, pour accéder à `/moderation`.

### Sur le NAS

La production tourne sur un QNAP TS-233 avec `docker-compose.nas.yml`, exposée par Cloudflare Tunnel
sans port ouvert. Le code, le fichier `.env` et les sauvegardes sont dans
`/share/CACHEDEV1_DATA/project-achievers`.

Pour publier le dernier commit local, avec la clé SSH `~/.ssh/pa_nas` :

```bash
bash scripts/deploy-nas.sh
```

Une sauvegarde de la base est écrite chaque jour dans `backups/`, 14 jours sont conservés. Pour en
restaurer une sur une base vide :

```bash
docker exec -i project-achievers-db-1 pg_restore -U achievers -d achievers --clean --if-exists < backups/achievers-AAAA-MM-JJ.dump
```

## Structure

```
prisma/                    Schéma et migrations
src/hooks.server.ts        Sessions, limites de débit, en-têtes, démarrage des tâches
src/lib/server/providers/  Authentification Steam, Discord, Xbox, PSN
src/lib/server/sync/       Synchronisation par plateforme et file de tâches
src/lib/server/queries.ts  Lectures partagées entre les pages
src/routes/                Pages et points d'accès
e2e/                       Tests Playwright
```
