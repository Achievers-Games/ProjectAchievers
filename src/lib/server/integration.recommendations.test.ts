// Tests sur un vrai PostgreSQL : les prochains 100 % proposés au joueur.
import 'dotenv/config';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { dismissSuggestion, MIN_LIKED, resetTagRarity, suggestions } from './recommendations';
import { PREFIX, setupIntegration } from './test-helpers';

setupIntegration();
beforeEach(() => resetTagRarity());

// Des étiquettes propres à ces tests : le catalogue semé n'y change rien.
const SOULS = 9_900_001;
const DARK = 9_900_002;
const FARM = 9_900_003;
const COZY = 9_900_004;

const player = () =>
  db.user.create({
    data: { handle: `${PREFIX}-${crypto.randomUUID()}`, displayName: `${PREFIX} joueur` },
  });

interface Own {
  tags?: number[];
  completion?: number;
  minutes?: number;
  platform?: 'STEAM' | 'PSN';
  familyKey?: string;
  hidden?: boolean;
  rarity?: number;
  lure?: number;
}

async function own(userId: string, label: string, options: Own = {}) {
  const platformGameId = `${PREFIX}-${crypto.randomUUID()}`;
  const game = await db.game.create({
    data: {
      platform: options.platform ?? 'STEAM',
      platformGameId,
      name: `${PREFIX} ${label}`,
      slug: platformGameId.toLowerCase(),
      totalAchievements: 10,
      tags: options.tags ?? [],
      familyKey: options.familyKey ?? null,
      achievements: {
        create: {
          platformAchievementId: 'A',
          name: 'A',
          globalRarity: options.rarity ?? 12,
        },
      },
      players: {
        create: {
          userId,
          totalCount: 10,
          unlockedCount: Math.floor((options.completion ?? 0) / 10),
          completion: options.completion ?? 0,
          playtimeMinutes: options.minutes ?? 0,
          hidden: options.hidden ?? false,
        },
      },
    },
  });
  if (options.lure) {
    await db.lureGame.create({
      data: {
        steamAppId: platformGameId,
        found: true,
        completionistMinutes: options.lure,
        fetchedAt: new Date(),
      },
    });
  }
  return game;
}

/** Un joueur qui finit des jeux sombres et difficiles, et n'a presque pas touché au reste. */
async function soulsFan() {
  const user = await player();
  for (let i = 0; i < MIN_LIKED; i++) {
    await own(user.id, `Fini ${i}`, { tags: [SOULS, DARK], completion: 100, minutes: 3000 });
  }
  // Le catalogue connaît aussi d'autres genres : sans eux, aucune étiquette ne distingue rien.
  const other = await player();
  for (let i = 0; i < 3; i++) await own(other.id, `Autre ${i}`, { tags: [FARM, COZY] });
  return user;
}

const names = (items: { game: { name: string } }[]) =>
  items.map((item) => item.game.name.replace(`${PREFIX} `, ''));

describe('suggestions de l’accueil', () => {
  it('se tait tant que les goûts du joueur sont inconnus', async () => {
    const user = await player();
    for (let i = 0; i < MIN_LIKED - 1; i++) {
      await own(user.id, `Fini ${i}`, { tags: [SOULS], completion: 100 });
    }
    await own(user.id, 'Pas lancé', { tags: [SOULS] });
    expect(await suggestions(user.id)).toBeNull();
  });

  it('propose d’abord ce qui ressemble aux jeux aimés, avec la raison et le temps du 100 %', async () => {
    const user = await soulsFan();
    await own(user.id, 'Ferme', { tags: [FARM, COZY] });
    await own(user.id, 'Mélange', { tags: [FARM, DARK] });
    await own(user.id, 'Âmes', { tags: [SOULS, DARK], lure: 2400 });
    await own(user.id, 'Presque', { tags: [SOULS, DARK], completion: 80, minutes: 600 });
    await own(user.id, 'Ferme presque', { tags: [FARM, COZY], completion: 90, minutes: 10 });
    await own(user.id, 'Entamé', { tags: [SOULS, DARK], completion: 20, minutes: 600 });

    const found = (await suggestions(user.id))!;
    // Un jeu entamé n'est ni à commencer, ni bientôt fini ; un jeu fini n'est plus proposé.
    expect(names(found.start).slice(0, 2)).toEqual(['Âmes', 'Mélange']);
    expect(names(found.finish)).toEqual(['Presque', 'Ferme presque']);
    expect(found.start[0]).toMatchObject({
      reason: { finished: true, name: expect.stringContaining('Fini') },
      hours: 40,
    });
    // Lancer une ferme une seule fois ne fait pas aimer les fermes : elle reste en bas de liste.
    expect(names(found.start).indexOf('Ferme')).not.toBe(0);
  });

  it('réunit les versions d’un jeu, et écarte cachés, bloqués, finis ailleurs et hors de portée', async () => {
    const user = await soulsFan();
    const tags = [SOULS, DARK];
    const family = `${PREFIX}-${crypto.randomUUID()}`;
    await own(user.id, 'Double', { tags, familyKey: family });
    await own(user.id, 'Double PS5', { tags, familyKey: family, platform: 'PSN' });
    await own(user.id, 'Même nom', { tags });
    await own(user.id, 'Même nom', { tags, platform: 'PSN' });
    const ended = `${PREFIX}-${crypto.randomUUID()}`;
    await own(user.id, 'Fini ailleurs', { tags, familyKey: ended, completion: 100 });
    await own(user.id, 'Fini ailleurs PS5', { tags, familyKey: ended, platform: 'PSN' });
    await own(user.id, 'Caché', { tags, hidden: true });
    const blocked = await own(user.id, 'Bloqué', { tags });
    await db.steamIntegrityReview.create({
      data: {
        steamId: `${PREFIX}-${crypto.randomUUID()}`,
        userId: user.id,
        gameId: blocked.id,
        status: 'REJECTED',
        suspendedAt: new Date(),
        flagged: [],
        approved: [],
        rejected: [],
        snapshot: [],
      },
    });
    await own(user.id, 'Impossible', { tags, rarity: 0 });
    await own(user.id, 'Impossible mais au bout', { tags, rarity: 0, completion: 95 });

    const found = (await suggestions(user.id))!;
    const start = names(found.start);
    expect(start.filter((name) => name.startsWith('Double'))).toHaveLength(1);
    expect(start.filter((name) => name === 'Même nom')).toHaveLength(1);
    expect(start).toHaveLength(2);
    expect(names(found.finish)).toEqual(['Impossible mais au bout']);
  });

  it('oublie un jeu écarté par le joueur, versions comprises, jusqu’à ce qu’il annule', async () => {
    const user = await soulsFan();
    const familyKey = `${PREFIX}-${crypto.randomUUID()}`;
    const steam = await own(user.id, 'Écarté', { tags: [SOULS, DARK], familyKey });
    await own(user.id, 'Écarté PS5', { tags: [SOULS, DARK], familyKey, platform: 'PSN' });
    expect((await suggestions(user.id))!.start).toHaveLength(1);

    expect(await dismissSuggestion(user.id, steam.id, true)).toBe(true);
    expect(await dismissSuggestion(user.id, steam.id, true)).toBe(true);
    expect((await suggestions(user.id))!.start).toHaveLength(0);
    // Le choix d'un joueur n'engage que lui, et porte sur ses propres jeux.
    const stranger = await player();
    expect(await dismissSuggestion(stranger.id, steam.id, true)).toBe(false);

    expect(await dismissSuggestion(user.id, steam.id, false)).toBe(true);
    expect((await suggestions(user.id))!.start).toHaveLength(1);
  });
});
