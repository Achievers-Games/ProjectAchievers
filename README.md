# Project Achievers

Application de bureau communautaire pour les chasseurs de succès (achievements/trophées) de jeux vidéo.

## Fonctionnalités

- **Liaison de comptes** : Steam (OAuth), PlayStation (NPSSO, import manuel PSNProfiles)
- **Bibliothèque de jeux** : Liste complète avec filtres et recherche
- **Détail des succès** : Progression, rareté globale, statut déverrouillé
- **Guides** : Guides générés par IA + guides communautaires avec système de vote
- **Commentaires** : Section commentaires sous chaque succès avec réactions (imbriqués)
- **Recommandations** : Jeux recommandés basés sur vos succès et platiniums
- **Profil** : Vue d'ensemble de vos succès, platiniums, guides créés
- **Application de bureau** : Tauri + Next.js, disponible sur Windows, macOS, Linux

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Bureau | Tauri v2 (Rust) |
| UI | shadcn/ui, Tailwind CSS |
| Base de données | SQLite (sqlx) |
| État | TanStack Query, Zustand |
| Design | Inspiration kyara.games + PSTHC |

## Développement

### Prérequis

- Node.js 20+
- Rust 1.75+
- Tauri CLI (`cargo install tauri-cli`)

### Installation

```bash
# Cloner le repo
git clone https://github.com/ProjectAchievers/project-achievers.git
cd project-achievers

# Installer les dépendances
npm install

# Lancer en mode développement
npm run tauri:dev

# Construire pour la production
npm run tauri:build
```

### Scripts disponibles

| Script | Description |
|--------|-------------|
| `npm run dev` | Lance Next.js en mode dev |
| `npm run tauri:dev` | Lance l'app Tauri en mode dev |
| `npm run tauri:build` | Construit les installeurs de production |
| `npm run build` | Construit le frontend Next.js |
| `npm run lint` | Lance ESLint |
| `npm run test` | Lance les tests Vitest |

## Structure du projet

```
project-achievers/
├── src/                          # Frontend Next.js
│   ├── app/                      # App Router pages
│   ├── components/               # Composants React
│   ├── lib/                      # Utilitaires et types Tauri
│   ├── hooks/                    # Hooks personnalisés
│   └── stores/                   # Stores Zustand
├── src-tauri/                    # Backend Rust (Tauri)
│   ├── src/
│   │   ├── commands/             # Commandes Tauri (IPC)
│   │   ├── database/             # SQLite et migrations
│   │   └── crypto/               # Chiffrement des tokens
│   ├── migrations/               # Migrations SQL
│   └── Cargo.toml
├── .github/workflows/            # CI/CD (GitHub Actions)
└── package.json
```

## Limites connues

- **PSN** : Sony ne propose pas d'API publique pour les trophées. L'intégration PSN est limitée (affichage uniquement ou import manuel via PSNProfiles).
- **Steam** : Nécessite une clé API Steam Web pour accéder aux données utilisateur.

## Licence

MIT