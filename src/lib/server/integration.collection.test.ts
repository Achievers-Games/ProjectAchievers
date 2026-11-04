// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { activityFeed, cardFeed, collectors, listGames, userCards } from './queries';
import { grantFrames } from './frames';
import { resolveIdentity } from './accounts';
import {
  consolesOf,
  copiesFor,
  difficultyTier,
  nextCopy,
  psnConsole,
  stepOf,
  xboxConsole,
} from '$lib/collection';
import { db } from './db';
import { familyKey, matchFamilies } from './family';
import { groupLibrary } from './library';
import { saveAchievements, upsertGame } from './sync/store';
import { PREFIX, identity, setupIntegration } from './test-helpers';

setupIntegration();

describe('jeux sur plusieurs plateformes', () => {
  it('reconnaît un même jeu malgré les mentions commerciales', () => {
    expect(familyKey('HEAVY RAIN™')).toBe(familyKey('Heavy Rain'));
    expect(familyKey('Little Nightmares Enhanced Edition')).toBe(familyKey('Little Nightmares'));
    expect(familyKey('The Witcher 3: Wild Hunt — Remastered')).toBe(
      familyKey('The Witcher 3: Wild Hunt'),
    );
    expect(familyKey('Persona 5 Royal')).not.toBe(familyKey('Persona 4 Golden'));
    expect(familyKey('Hotline Miami 2: Wrong Number')).not.toBe(familyKey('Hotline Miami'));
    expect(familyKey('Remastered')).not.toBe('');
  });

  it('réunit deux noms différents quand leurs listes de succès sont identiques', async () => {
    const tag = `${PREFIX}${Math.random().toString(36).slice(2, 8)}`;
    const names = [
      'Premier pas',
      'Deuxième acte',
      'Troisième vague',
      'Quatre saisons',
      'Cinq sur cinq',
    ];
    const list = (extra: string[] = []) =>
      [...names, ...extra].map((name, i) => ({
        platformAchievementId: `${tag}-${i}`,
        name: `${tag} ${name}`,
        description: '',
        hidden: false,
        trophyType: 'BRONZE' as const,
      }));
    const game = (platform: 'STEAM' | 'PSN' | 'XBOX', name: string) =>
      upsertGame({ platform, platformGameId: `${tag}-${platform}`, name });
    const steam = await game('STEAM', `${tag} Saison Deux`);
    const psn = await game('PSN', `${tag} Season 2 Trophies`);
    const xbox = await game('XBOX', `${tag} Saison Deux Bis`);
    await saveAchievements(steam.id, list());
    // Le Platine n'existe que sur PSN : il ne compte pas dans la comparaison.
    await saveAchievements(psn.id, [
      ...list(),
      {
        platformAchievementId: `${tag}-platine`,
        name: `${tag} Platine`,
        description: '',
        hidden: false,
        trophyType: 'PLATINUM',
      },
    ]);
    // Un succès de plus : ce n'est plus le même jeu.
    await saveAchievements(xbox.id, list(['Bonus']));
    // Une réédition sur la même plateforme, avec la même liste, reste le même jeu.
    const remaster = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${tag}-legacy`,
      name: `${tag} Saison Deux Legacy`,
    });
    await saveAchievements(remaster.id, list());

    await matchFamilies();
    const key = async (id: string) =>
      (await db.game.findUniqueOrThrow({ where: { id }, select: { familyKey: true } })).familyKey;
    expect(await key(psn.id)).toBe(await key(steam.id));
    expect(await key(remaster.id)).toBe(await key(steam.id));
    expect(await key(xbox.id)).not.toBe(await key(steam.id));

    // La synchronisation suivante ne défait pas la famille trouvée par les succès.
    await game('PSN', `${tag} Season 2 Trophies`);
    expect(await key(psn.id)).toBe(await key(steam.id));

    // Une liste qui change rend au jeu la famille de son nom.
    await saveAchievements(psn.id, list(['Nouveau DLC']));
    await matchFamilies();
    expect(await key(psn.id)).toBe(familyKey(`${tag} Season 2 Trophies`));
  });

  const row = (platform: 'STEAM' | 'PSN', completion: number, key: string | null = 'jeu') => ({
    unlockedCount: 1,
    completion,
    platinum: false,
    lastUnlockedAt: null,
    game: {
      id: `${platform}-${key}`,
      name: 'Jeu',
      slug: platform.toLowerCase(),
      platform,
      coverUrl: null,
      headerUrl: null,
      totalAchievements: 2,
      familyKey: key,
      tier: null as number | null,
    },
  });

  it('fixe les paliers avant le 100 %', () => {
    expect([0, 24.9, 25, 49, 50, 74, 75, 99, 100].map(stepOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0]);
  });

  it('réunit les versions sur la plus avancée, sans pénaliser une version finie', () => {
    const [card] = groupLibrary([row('PSN', 40), row('STEAM', 100)]);
    expect(card).toMatchObject({ slug: 'steam', tier: 1, copies: 1 });
    expect(card?.progress.completion).toBe(100);
    expect(card?.versions.map((v) => v.platform)).toEqual(['STEAM', 'PSN']);
  });

  it('montre l’exemplaire suivant dès qu’une autre plateforme est commencée', () => {
    expect(nextCopy([{ platform: 'STEAM', completion: 40 }])).toBeNull();
    expect(nextCopy([{ platform: 'STEAM', completion: 100 }])).toBeNull();
    expect(
      nextCopy([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 0 },
      ]),
    ).toBeNull();
    expect(
      nextCopy([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 58 },
      ]),
    ).toEqual({ copies: 2, platform: 'PSN', console: null, completion: 58 });
    expect(
      nextCopy([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 100 },
        { platform: 'XBOX', completion: 12 },
      ]),
    ).toEqual({ copies: 3, platform: 'XBOX', console: null, completion: 12 });
  });

  it('ajoute un exemplaire à chaque plateforme finie, sans changer le niveau', () => {
    const [double] = groupLibrary([row('PSN', 100), row('STEAM', 100)]);
    expect(double).toMatchObject({ tier: 1, copies: 2 });
    expect(groupLibrary([row('PSN', 100), row('STEAM', 100)])).toHaveLength(1);
    expect(groupLibrary([row('PSN', 100, 'a'), row('STEAM', 100, 'b')])).toHaveLength(2);
    expect(copiesFor(5)).toBe(4);
  });

  it('compte chaque console PlayStation comme un exemplaire à part', () => {
    expect(['PS4', 'PS5,PS4', 'PSVITA', 'PS4,PSVITA', 'PSPC', '', null].map(psnConsole)).toEqual([
      'PS4',
      'PS4/PS5',
      'Vita',
      'PS4/Vita',
      null,
      null,
      null,
    ]);
    const on = (console: string, completion: number) => {
      const version = row('PSN', completion);
      return { ...version, game: { ...version.game, id: console, console } };
    };
    const [card] = groupLibrary([on('PS3', 100), on('PS4', 100), row('STEAM', 100)]);
    expect(card?.copies).toBe(3);
    expect(card?.versions.map((v) => v.console)).toEqual(['PS3', 'PS4', null]);
    expect(
      nextCopy([
        { platform: 'PSN', console: 'PS3', completion: 100 },
        { platform: 'PSN', console: 'PS4', completion: 30 },
      ]),
    ).toEqual({ copies: 2, platform: 'PSN', console: 'PS4', completion: 30 });
  });

  it('sépare Xbox 360 des listes One, Series et PC qu’elles partagent', () => {
    expect(
      [
        ['Xbox360'],
        ['XboxOne', 'XboxSeries', 'PC'],
        ['XboxSeries', 'PC'],
        ['PC'],
        ['Mobile'],
        [],
      ].map(xboxConsole),
    ).toEqual(['Xbox 360', 'Xbox One/Series', 'Xbox Series', 'PC', null, null]);
    expect(consolesOf('Xbox One/Series')).toEqual(['One', 'Series']);
    expect(consolesOf('PS4/PS5')).toEqual(['PS4', 'PS5']);
  });

  it('garde le niveau de la version finie la plus dure', () => {
    const version = (platform: 'STEAM' | 'PSN', completion: number, tier: number) => {
      const version = row(platform, completion);
      version.game.tier = tier;
      return version;
    };
    expect(groupLibrary([version('PSN', 100, 5), version('STEAM', 100, 2)])[0]?.tier).toBe(5);
    expect(groupLibrary([version('STEAM', 100, 2), version('PSN', 50, 6)])[0]?.tier).toBe(2);
  });

  it('classe un jeu selon son succès le plus rare, sinon selon sa taille', () => {
    expect([40, 10, 5, 2, 1.5, 0.5, 0.2].map((rarity) => difficultyTier(rarity, 30))).toEqual([
      1, 1, 2, 3, 4, 5, 6,
    ]);
    expect([10, 30, 50, 100, 200, 8000].map((size) => difficultyTier(null, size))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe('filtres par niveau', () => {
  async function library(extraCards = 0) {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    const userId = result.userId;
    const add = async (
      name: string,
      platform: 'STEAM' | 'PSN',
      completion: number,
      familyKey?: string,
      tier?: number,
    ) => {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          familyKey,
          tier,
        },
      });
      await db.userGame.create({
        data: { userId, gameId: game.id, completion, unlockedCount: 0, totalCount: 10 },
      });
    };
    const key = () => `${PREFIX}-${Math.random()}`;
    const platinum = key();
    const gold = key();
    await add('platine', 'STEAM', 100, platinum, 4);
    await add('platine', 'PSN', 100, platinum, 4);
    await add('or', 'STEAM', 100, gold);
    await add('or', 'PSN', 40, gold);
    await add('or seul', 'STEAM', 100);
    await add('presque', 'STEAM', 90);
    await add('debut', 'PSN', 10);
    for (let index = 0; index < extraCards; index++) await add(`carte ${index}`, 'STEAM', 100);
    return { sort: 'progression', page: 1, ownerId: userId } as const;
  }
  it('classe les cartes par niveau, puis par avancée vers l’exemplaire suivant', async () => {
    const { ownerId } = await library();
    const cards = await userCards(ownerId);
    expect(cards.map((card) => card.name)).toEqual([
      `${PREFIX} platine`,
      `${PREFIX} or`,
      `${PREFIX} or seul`,
    ]);
    expect(cards[1]?.next?.completion).toBe(40);
  });

  it('trie les jeux à finir par carte à gagner, la plus proche d’abord', async () => {
    const { ownerId } = await library();
    for (const [name, tier, completion] of [
      ['légendaire', 6, 20],
      ['prismatique loin', 5, 30],
      ['prismatique proche', 5, 80],
    ] as const) {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          tier,
        },
      });
      await db.userGame.create({
        data: { userId: ownerId, gameId: game.id, completion, unlockedCount: 1, totalCount: 10 },
      });
    }
    const { games } = await listGames(
      { sort: 'rarete', page: 1, ownerId, status: 'restants' },
      ownerId,
    );
    expect(games.slice(0, 4).map((game) => game.name)).toEqual([
      `${PREFIX} légendaire`,
      `${PREFIX} prismatique proche`,
      `${PREFIX} prismatique loin`,
      `${PREFIX} presque`,
    ]);
  });

  it('met les exemplaires multiples devant une carte rare seule', async () => {
    const { ownerId } = await library();
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} prismatique seul`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        totalAchievements: 10,
        tier: 5,
      },
    });
    await db.userGame.create({
      data: {
        userId: ownerId,
        gameId: game.id,
        completion: 100,
        unlockedCount: 10,
        totalCount: 10,
      },
    });
    const { games } = await listGames({ sort: 'progression', page: 1, ownerId }, ownerId);
    expect(games.slice(0, 2).map((card) => card.name)).toEqual([
      `${PREFIX} platine`,
      `${PREFIX} prismatique seul`,
    ]);
  });

  it('combine « Non 100 % » et un niveau : la carte à gagner compte', async () => {
    const { ownerId } = await library();
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} légendaire à finir`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        totalAchievements: 10,
        tier: 6,
      },
    });
    await db.userGame.create({
      data: { userId: ownerId, gameId: game.id, completion: 30, unlockedCount: 3, totalCount: 10 },
    });
    const { games } = await listGames(
      { sort: 'progression', page: 1, ownerId, status: 'restants', tier: 6 },
      ownerId,
    );
    expect(games.map((card) => card.name)).toEqual([`${PREFIX} légendaire à finir`]);
  });

  it('range un jeu selon sa rareté, fini ou non, quel que soit le statut', async () => {
    const { ownerId } = await library();
    for (const [name, completion] of [
      ['légendaire fini', 100],
      ['légendaire commencé', 40],
    ] as const) {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          tier: 6,
        },
      });
      await db.userGame.create({
        data: { userId: ownerId, gameId: game.id, completion, unlockedCount: 4, totalCount: 10 },
      });
    }
    const list = async (status?: 'termines' | 'restants') =>
      (await listGames({ sort: 'nom', page: 1, ownerId, status, tier: 6 }, ownerId)).games.map(
        (card) => card.name.replace(`${PREFIX} `, ''),
      );
    expect(await list()).toEqual(['légendaire commencé', 'légendaire fini']);
    expect(await list('termines')).toEqual(['légendaire fini']);
    expect(await list('restants')).toEqual(['légendaire commencé']);
  });

  it('filtre par console PlayStation, une liste partagée comptant pour chacune', async () => {
    const { ownerId } = await library();
    for (const [name, console] of [
      ['cross-gen', 'PS4/PS5'],
      ['ancien', 'PS3'],
    ] as const) {
      const game = await db.game.create({
        data: {
          platform: 'PSN',
          console,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
        },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 50,
          unlockedCount: 5,
          totalCount: 10,
        },
      });
    }
    const names = async (console: string) =>
      (
        await listGames(
          { sort: 'nom', page: 1, ownerId, platform: 'PSN', consoles: [console] },
          ownerId,
        )
      ).games.map((game) => game.name);
    expect(await names('PS5')).toEqual([`${PREFIX} cross-gen`]);
    expect(await names('PS4')).toEqual([`${PREFIX} cross-gen`]);
    expect(await names('PS3')).toEqual([`${PREFIX} ancien`]);
  });

  it('garde le niveau d’une carte quand la recherche ne vise qu’une version', async () => {
    const { ownerId } = await library();
    const family = `${PREFIX}-${Math.random()}`;
    const names = ['Royal', 'Classique'];
    for (const [index, platform] of (['STEAM', 'PSN'] as const).entries()) {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${names[index]}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          totalAchievements: 10,
          familyKey: family,
        },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
        },
      });
    }
    const { games } = await listGames({ sort: 'nom', page: 1, ownerId, q: 'classique' }, ownerId);
    expect(games).toHaveLength(1);
    expect(games[0]?.copies).toBe(2);
  });

  it('garde les jeux cachés et non classés hors des fils publics', async () => {
    const { ownerId } = await library();
    await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });
    const add = async (name: string, contentCheckedAt: Date | null, hidden: boolean) => {
      const game = await db.game.create({
        data: {
          platform: 'STEAM',
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} ${name}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          contentCheckedAt,
        },
      });
      const achievement = await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: '0', name },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 1,
          totalCount: 1,
          hidden,
          lastUnlockedAt: new Date(Date.now() + 60_000),
        },
      });
      await db.userAchievement.create({
        data: {
          userId: ownerId,
          achievementId: achievement.id,
          unlockedAt: new Date(Date.now() + 60_000),
        },
      });
    };
    await add('visible', new Date(), false);
    await add('secret', new Date(), true);
    await add('non classe', null, false);

    const feed = (await activityFeed()).map((row) => row.achievement.name);
    expect(feed).toContain('visible');
    expect(feed).not.toContain('secret');
    expect(feed).not.toContain('non classe');
    const cards = (await cardFeed()).map((row) => row.game.name);
    expect(cards).toContain(`${PREFIX} visible`);
    expect(cards).not.toContain(`${PREFIX} non classe`);
  });

  it('annonce le niveau et les exemplaires de chaque carte du fil', async () => {
    const { ownerId } = await library();
    await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });
    // Deux plateformes, un seul jeu : une carte, deux exemplaires.
    const family = `${PREFIX}-${Math.random()}`;
    for (const [index, platform] of (['STEAM', 'PSN'] as const).entries()) {
      const game = await db.game.create({
        data: {
          platform,
          platformGameId: `${PREFIX}-${Math.random()}`,
          name: `${PREFIX} exemplaire ${index}`,
          slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
          familyKey: family,
          tier: 4,
          contentCheckedAt: new Date(),
        },
      });
      await db.userGame.create({
        data: {
          userId: ownerId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
          lastUnlockedAt: new Date(),
        },
      });
    }

    const card = (await cardFeed()).find((row) => row.game.name.startsWith(`${PREFIX} exemplaire`));
    expect(card).toMatchObject({ copies: 2, game: { tier: 4 } });
  });

  it('classe les collections selon leurs cartes, jeux réunis', async () => {
    const { ownerId } = await library();
    const user = await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });
    const row = (await collectors(10_000)).find((entry) => entry.handle === user.handle);
    expect(row).toMatchObject({ cards: 3, tiers: [2, 0, 0, 1, 0, 0], score: 350 });
  });

  it('attribue une fois les cadres, et les garde', async () => {
    const { ownerId } = await library(7);
    await db.user.update({ where: { id: ownerId }, data: { isPublic: true } });

    await grantFrames();
    await grantFrames();
    const owned = await db.userFrame.findMany({ where: { userId: ownerId, frame: 'collector' } });
    expect(owned).toHaveLength(1);

    await db.userGame.deleteMany({ where: { userId: ownerId } });
    await grantFrames();
    expect(await db.userFrame.count({ where: { userId: ownerId, frame: 'collector' } })).toBe(1);
  });

  const names = (result: Awaited<ReturnType<typeof listGames>>) =>
    result.games.map((game) => game.name.replace(`${PREFIX} `, ''));

  it('garde le niveau de la carte quand on filtre par plateforme', async () => {
    const filters = await library();
    const steam = await listGames({ ...filters, platform: 'STEAM', tier: 4 }, filters.ownerId);
    expect(names(steam)).toEqual(['platine']);
  });

  it('place chaque carte selon son avancée vers l’exemplaire suivant', async () => {
    const filters = await library();
    expect(names(await listGames(filters, filters.ownerId))).toEqual([
      'platine',
      'or',
      'or seul',
      'presque',
      'debut',
    ]);
  });

  it('garde dans « Non 100 % » les cartes dont une autre version avance', async () => {
    const filters = await library();
    const unfinished = await listGames({ ...filters, status: 'restants' }, filters.ownerId);
    expect(names(unfinished)).toEqual(['presque', 'or', 'debut']);
  });
});
