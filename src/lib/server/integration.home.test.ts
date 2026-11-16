import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { resolveIdentity } from './accounts';
import { homeBanners, homePopularGames, homePodium } from './queries';
import { invalidatePublicCache } from './public-cache';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();
async function player() {
  const result = await resolveIdentity(identity(), null);
  if (!result.ok) throw new Error('Missing player');
  return result.userId;
}

describe('lectures de l’accueil', () => {
  it('sélectionne une seule bannière sans charger la bibliothèque et garde la bonne progression multiversion', async () => {
    const userId = await player();
    const key = `${PREFIX}-${Math.random()}`;
    const add = async (
      suffix: string,
      completion: number,
      platform: 'STEAM' | 'PSN',
      group = suffix,
      hidden = false,
      adultOnly = false,
      header = true,
    ) => {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${key}-${suffix}`,
          slug: `${key}-${suffix}`,
          name: `${PREFIX} ${suffix}`,
          familyKey: `${key}-${group}`,
          totalAchievements: 10,
          adultOnly,
          headerUrl: header ? `https://example.test/${suffix}/header.jpg` : null,
        },
      });
      await db.userGame.create({ data: { userId, gameId: game.id, completion, hidden } });
      return game;
    };
    const complete = await add('termine', 100, 'STEAM', 'commun');
    await add('exemplaire-suivant', 85, 'PSN', 'commun');
    await add('autre', 80, 'STEAM');
    await add('cache', 99, 'STEAM', 'cache', true);
    await add('adulte', 99, 'STEAM', 'adulte', false, true);
    await add('sans-image', 98, 'STEAM', 'sans-image', false, false, false);
    await add('meme-plateforme', 99, 'STEAM', 'commun');
    const spy = vi
      .spyOn(db.userGame, 'findMany')
      .mockRejectedValue(new Error('Bibliothèque complète interdite'));
    try {
      const banners = await homeBanners(undefined, userId);
      expect(banners.season).toMatchObject({ slug: complete.slug, completion: 85 });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('ne partage pas les bannières personnelles entre deux joueurs', async () => {
    const userId = await player(),
      otherId = await player();
    for (const [id, completion] of [
      [userId, 33],
      [otherId, 77],
    ] as const) {
      const slug = `${PREFIX}-${Math.random()}`;
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: slug,
          slug,
          name: slug,
          headerUrl: 'https://example.test/header.jpg',
          totalAchievements: 10,
        },
      });
      await db.userGame.create({ data: { userId: id, gameId: game.id, completion } });
    }
    expect((await homeBanners(undefined, userId)).season?.completion).toBe(33);
    expect((await homeBanners(undefined, otherId)).season?.completion).toBe(77);
  });

  it('partage le podium et les huit jeux publics puis les relit après invalidation', async () => {
    invalidatePublicCache();
    expect(await homePodium()).toBe(await homePodium());
    const popular = await homePopularGames();
    expect(popular).toHaveLength(8);
    expect(await homePopularGames()).toBe(popular);
    invalidatePublicCache();
    expect(await homePopularGames()).not.toBe(popular);
  });

  it('habille la bannière du classement avec le jeu de bannière du numéro 1', async () => {
    const userId = await player();
    const { handle } = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const key = `${PREFIX}-${Math.random()}`;
    const add = async (suffix: string, completion: number, adultOnly = false) => {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${key}-${suffix}`,
          slug: `${key}-${suffix}`,
          name: `${PREFIX} ${suffix}`,
          familyKey: `${key}-${suffix}`,
          totalAchievements: 10,
          adultOnly,
          headerUrl: `https://example.test/${suffix}/header.jpg`,
        },
      });
      await db.userGame.create({ data: { userId, gameId: game.id, completion } });
      return game;
    };
    const showcased = await add('vitrine', 100);
    const chosen = await add('banniere', 40);
    const adult = await add('adulte', 40, true);
    const leader = { handle } as Parameters<typeof homeBanners>[0];

    // Sans choix, le premier jeu de la vitrine, avec son pourcentage.
    expect((await homeBanners(leader)).ranking).toMatchObject({ slug: showcased.slug });

    await db.user.update({ where: { id: userId }, data: { bannerGameId: chosen.id } });
    expect((await homeBanners(leader)).ranking).toMatchObject({
      slug: chosen.slug,
      completion: null,
    });

    // L'accueil est public : un jeu pour adultes choisi laisse la place à la vitrine.
    await db.user.update({ where: { id: userId }, data: { bannerGameId: adult.id } });
    expect((await homeBanners(leader)).ranking).toMatchObject({ slug: showcased.slug });
  });
});
