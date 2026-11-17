// Tests sur un vrai PostgreSQL : la grille paginée de /compte/fond.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { db } from './db';
import { resolveIdentity } from './accounts';
import { APPEARANCE_PAGE, appearanceGames } from './appearance-games';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { GET } from '../../routes/compte/fond/jeux/+server';

setupIntegration();

async function player() {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('Missing player');
  return result.userId;
}

describe('grille de la bannière et du fond', () => {
  it('pagine toute la bibliothèque, une version par famille', async () => {
    const userId = await player();
    const other = await player();
    const key = `${PREFIX}-${Math.random()}`;
    const total = APPEARANCE_PAGE + 5;
    for (let i = 0; i < total; i++) {
      for (const platform of ['STEAM', 'PSN'] as const) {
        const game = await db.game.create({
          data: {
            platform,
            platformGameId: `${key}-${i}-${platform}`,
            slug: `${key}-${i}-${platform}`,
            name: `${PREFIX} ${String(i).padStart(3, '0')} ${platform}`,
            familyKey: `${key}-${i}`,
            headerUrl: `https://example.test/${i}/header.jpg`,
            artUrl: `https://example.test/${i}/art.jpg`,
          },
        });
        await db.userGame.create({ data: { userId, gameId: game.id } });
      }
    }

    const first = await appearanceGames(userId, 'fond', { q: PREFIX });
    const second = await appearanceGames(userId, 'fond', { q: PREFIX, page: 2 });
    expect(first.pages).toBe(2);
    expect(first.games).toHaveLength(APPEARANCE_PAGE);
    expect(second.games).toHaveLength(5);
    const ids = [...first.games, ...second.games].map((game) => game.id);
    expect(new Set(ids).size).toBe(total);

    // Le point d'accès ne lit que la bibliothèque du joueur connecté.
    const response = await GET({
      url: new URL(`https://achievers.games/compte/fond/jeux?cible=fond&q=${PREFIX}&page=2`),
      locals: { user: { id: other } },
    } as never);
    expect(((await response.json()) as { games: unknown[] }).games).toHaveLength(0);
    await expect(
      GET({ url: new URL('https://achievers.games/compte/fond/jeux'), locals: {} } as never),
    ).rejects.toMatchObject({ status: 303 });
  });
});
