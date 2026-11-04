// Le client se construit à l'évaluation du module, souvent avant `env.ts` (qui lit `.env`) :
// en développement, l'URL manquait et `pg` partait sur son port par défaut. Charger `.env` ici
// rend le module autosuffisant, sans écraser les variables déjà définies (tests, conteneur).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '#prisma';

/**
 * Depuis Prisma 7, le client passe par le pilote `pg` : plus aucun moteur binaire à
 * générer par architecture (le NAS est en ARM). Le serveur et le seed passent par la
 * même fabrique ; seule l'instance qui les utilise diffère.
 */
export function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  // Le module est aussi évalué pendant `vite build`, où `.env` n'existe pas : sans URL,
  // `pg` garde ses valeurs par défaut et rien ne se connecte. La configuration est de
  // toute façon validée au démarrage du serveur (`hooks.server.ts`).
  return new PrismaClient({ adapter: new PrismaPg(url ? { connectionString: url } : {}) });
}
