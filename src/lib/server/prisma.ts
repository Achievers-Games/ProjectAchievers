import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env';
import { PrismaClient } from '#prisma';

/**
 * Depuis Prisma 7, le client passe par le pilote `pg` : plus aucun moteur binaire à
 * générer par architecture (le NAS est en ARM). Le serveur et le seed passent par la
 * même fabrique ; seule l'instance qui les utilise diffère.
 */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: env().DATABASE_URL }) });
}
