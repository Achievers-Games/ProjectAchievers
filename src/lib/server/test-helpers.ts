import 'dotenv/config';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import type { Identity } from './accounts';
import { db } from './db';

const PREFIX = 'zz-test';
const STEAM_ID = '76561190000000001';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  provider: 'STEAM',
  providerUserId: `${PREFIX}-${Math.random()}`,
  displayName: `${PREFIX} joueur`,
  ...overrides,
});

/** Les jeux et comptes créés ici portent tous ce préfixe : un seul nettoyage suffit. */
export async function cleanup() {
  await db.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await db.game.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

/** Chaque fichier de test part d'une base propre et rend ses simulations de fetch. */
export function setupIntegration() {
  beforeAll(cleanup);
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });
}

export { PREFIX, STEAM_ID, identity };
