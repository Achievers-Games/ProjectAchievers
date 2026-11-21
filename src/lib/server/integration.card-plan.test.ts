// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, describe, expect, it } from 'vitest';
import { CARD_CATALOGUE } from '#lib/card-catalogue';
import { cardPlan, saveCardPlan } from './card-plan';
import { db } from './db';
import { upsertGame } from './sync/store';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
afterAll(() => db.cardPlan.deleteMany({ where: { familyKey: { startsWith: PREFIX } } }));

/** Un jeu du site, sur une ou plusieurs plateformes, avec ses joueurs. */
async function family(
  label: string,
  versions: { platform: 'STEAM' | 'PSN'; appId: string; heroUrl?: string; adultOnly?: boolean }[],
  players = 0,
) {
  const familyKey = `${PREFIX}-${label}-${Math.random()}`;
  for (const version of versions) {
    const game = await upsertGame({
      platform: version.platform,
      platformGameId: version.appId,
      name: `${PREFIX} ${label}`,
    });
    await db.game.update({
      where: { id: game.id },
      data: {
        familyKey,
        familyLocked: true,
        heroUrl: version.heroUrl ?? null,
        adultOnly: version.adultOnly ?? false,
      },
    });
    for (let i = 0; i < players; i++) {
      const user = await db.user.create({
        data: { handle: `${PREFIX}-${Math.random()}`, displayName: `${PREFIX} joueur` },
      });
      await db.userGame.create({ data: { userId: user.id, gameId: game.id } });
    }
  }
  return familyKey;
}

describe('les cartes à créer', () => {
  it('liste chaque jeu une fois, les plus joués d’abord, avec ses visuels', async () => {
    const tag = `${Math.random()}`.slice(2, 8);
    const popular = await family(
      `plan-${tag}-a`,
      [
        { platform: 'STEAM', appId: `${PREFIX}-a-${tag}`, heroUrl: 'https://cdn/hero.jpg' },
        { platform: 'PSN', appId: `${PREFIX}-a-psn-${tag}` },
      ],
      2,
    );
    const quiet = await family(`plan-${tag}-b`, [
      { platform: 'STEAM', appId: `${PREFIX}-b-${tag}` },
    ]);
    await family(`plan-${tag}-c`, [
      { platform: 'STEAM', appId: `${PREFIX}-c-${tag}`, adultOnly: true },
    ]);

    const all = await cardPlan('toutes', `plan-${tag}`, 1);
    // Le jeu réservé aux adultes n'aura jamais de carte ; les deux versions du premier comptent une fois.
    expect(all.rows.map((row) => row.familyKey)).toEqual([popular, quiet]);
    expect(all.rows[0]).toMatchObject({
      players: 4,
      heroUrl: 'https://cdn/hero.jpg',
      steamAppId: `${PREFIX}-a-${tag}`,
      made: false,
      mythiqueArtUrl: null,
    });
    expect(all.totals.cardsLeft).toBe((all.totals.games - all.totals.made) * 3);

    expect(
      (await cardPlan('sans-hero', `plan-${tag}`, 1)).rows.map((row) => row.familyKey),
    ).toEqual([quiet]);
    await saveCardPlan(popular, 'https://cdn/art.jpg', 'Affiche officielle');
    const withArt = await cardPlan('sans-artwork', `plan-${tag}`, 1);
    expect(withArt.rows.map((row) => row.familyKey)).toEqual([quiet]);
    expect((await cardPlan('toutes', `plan-${tag}`, 1)).rows[0]).toMatchObject({
      mythiqueArtUrl: 'https://cdn/art.jpg',
      note: 'Affiche officielle',
    });
  });

  it('compte comme faits les jeux du catalogue', async () => {
    const appId = CARD_CATALOGUE[0]!.steamAppId;
    const existing = await db.game.findFirst({
      where: { platform: 'STEAM', platformGameId: appId },
    });
    if (existing) return; // La base de développement a déjà ce jeu : rien à créer.
    const tag = `${Math.random()}`.slice(2, 8);
    const key = await family(`plan-${tag}-done`, [{ platform: 'STEAM', appId }]);
    const done = await cardPlan('faites', `plan-${tag}`, 1);
    expect(done.rows.map((row) => row.familyKey)).toEqual([key]);
    expect((await cardPlan('a-faire', `plan-${tag}`, 1)).rows).toEqual([]);
  });
});
