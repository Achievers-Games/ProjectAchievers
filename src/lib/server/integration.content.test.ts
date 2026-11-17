// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listGames, seasonStats } from './queries';
import {
  checkSiteAchievements,
  clanAchievementBoard,
  reviewNewPlayers,
  grantSiteAchievement,
  siteAchievementBoard,
  siteSuggestions,
} from './site-achievements';
import { checkClanAchievements } from './clan-achievements';
import { resolveIdentity, updateProfile } from './accounts';
import { db } from './db';
import { onChat } from './sync/events';
import { parseSteamPage } from './sync/steam';
import { parseGameGuideFile, parseGuideFile, syncCuratedGuides } from './curated-guides';
import { editGuide } from './guides';
import { splitText, translateContent } from './translate';
import { isRateLimited, rateLimit } from './rate-limit';
import { ensureGameTexts, localizeAchievements } from './achievement-texts';
import { refreshDiscordAccounts } from './sync/discord';
import { UNKNOWN_ICON } from './site-icons';
import { notePsnToken, psnTokenState, warnPsnToken } from './service-token';
import { GENRES, SITE_TOTAL } from '#lib/site-achievements';
import { PREFIX, identity, setupIntegration } from './test-helpers';
import { m } from '#lib/paraglide/messages';

setupIntegration();

describe('traduction des guides et commentaires', () => {
  const answer = (content: string, finish_reason = 'stop') =>
    new Response(
      JSON.stringify({ result: { choices: [{ finish_reason, message: { content } }] } }),
    );

  async function guide() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} traduction`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const achievement = await db.achievement.create({
      data: { gameId: game.id, platformAchievementId: 'a', name: 'Succès' },
    });
    return db.guide.create({
      data: {
        achievementId: achievement.id,
        authorId: result.userId,
        contentMd: 'Reste derrière.',
      },
    });
  }

  it('ne demande la traduction qu’une fois par langue', async () => {
    const { id } = await guide();
    const fetchMock = vi.fn(async () => answer('Stay behind.'));
    vi.stubGlobal('fetch', fetchMock);

    expect(await translateContent({ guideId: id }, 'Reste derrière.', 'en')).toBe('Stay behind.');
    expect(await translateContent({ guideId: id }, 'Reste derrière.', 'en')).toBe('Stay behind.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne paie qu’une traduction pour deux demandes simultanées', async () => {
    const { id } = await guide();
    const fetchMock = vi.fn(async () => answer('Stay behind.'));
    vi.stubGlobal('fetch', fetchMock);

    const both = await Promise.all([
      translateContent({ guideId: id }, 'Reste derrière.', 'es'),
      translateContent({ guideId: id }, 'Reste derrière.', 'es'),
    ]);
    expect(both).toEqual(['Stay behind.', 'Stay behind.']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne garde pas une traduction coupée', async () => {
    const { id } = await guide();
    vi.stubGlobal('fetch', async () => answer('Stay', 'length'));

    await expect(translateContent({ guideId: id }, 'Reste derrière.', 'de')).rejects.toThrow();
    expect(await db.contentTranslation.count({ where: { guideId: id } })).toBe(0);
  });

  it('découpe un long texte aux paragraphes', () => {
    expect(splitText('aaaa\n\nbbbb\n\ncc', 10)).toEqual(['aaaa\n\nbbbb', 'cc']);
    expect(splitText('un seul bloc', 5)).toEqual(['un', 'seul', 'bloc']);
  });

  // En dernier : le quota du site, partagé par tout le fichier, reste épuisé jusqu'à la fin.
  it('ne compte pas au joueur une demande refusée par le quota du site', async () => {
    const { id } = await guide();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer('Stay behind.')),
    );
    const player = { key: `${PREFIX}-${Math.random()}`, perHour: 1 };
    while (rateLimit('traduction', 300, 3_600_000));

    expect(await translateContent({ guideId: id }, 'Reste derrière.', 'ja', player)).toBeNull();
    expect(isRateLimited(`traduction:${player.key}`, player.perHour)).toBe(false);
  });
});

describe('avatars animés', () => {
  it('suit l’animation du compte dont le profil utilise l’image', async () => {
    const id = identity({
      avatarUrl: 'https://a.test/fixe.png',
      avatarMotionUrl: 'https://a.test/anime.gif',
    });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    const read = () =>
      db.user.findUniqueOrThrow({
        where: { id: created.userId },
        select: { avatarMotionUrl: true },
      });
    expect(await read()).toEqual({ avatarMotionUrl: 'https://a.test/anime.gif' });

    await resolveIdentity({ ...id, avatarMotionUrl: null }, null);
    expect(await read()).toEqual({ avatarMotionUrl: null });

    await resolveIdentity(id, null);
    expect(await read()).toEqual({ avatarMotionUrl: 'https://a.test/anime.gif' });

    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    await updateProfile(created.userId, {
      displayName: 'Pseudo',
      handle: user.handle,
      avatarUrl: '',
    });
    expect(await read()).toEqual({ avatarMotionUrl: null });
  });
});

describe('cadres importés', () => {
  it('suit le cadre de la plateforme, et le retire avec elle', async () => {
    const id = identity({ frameUrl: 'https://a.test/cadre.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    const where = { id: created.userId };
    await db.user.update({ where, data: { frame: 'https://a.test/cadre.png' } });

    await resolveIdentity({ ...id, frameUrl: 'https://a.test/autre.png' }, null);
    expect((await db.user.findUniqueOrThrow({ where })).frame).toBe('https://a.test/autre.png');

    await resolveIdentity({ ...id, frameUrl: null }, null);
    expect((await db.user.findUniqueOrThrow({ where })).frame).toBeNull();
  });

  it('suit le nouvel avatar d’un compte déjà choisi', async () => {
    const id = identity({ avatarUrl: 'https://a.test/ancien.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');

    await resolveIdentity({ ...id, avatarUrl: 'https://a.test/nouveau.png' }, null);
    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.avatarUrl).toBe('https://a.test/nouveau.png');
  });

  it('suit Discord sans jeton de joueur', async () => {
    const stale = await db.linkedAccount.findMany({ where: { provider: 'DISCORD' } });
    await db.linkedAccount.updateMany({
      where: { provider: 'DISCORD' },
      data: { lastSyncedAt: new Date() },
    });
    const id = identity({
      provider: 'DISCORD',
      providerUserId: `${PREFIX}-${Math.random()}`,
      avatarUrl: 'https://cdn.discordapp.com/avatars/1/ancien.png?size=128',
    });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            id: '1',
            avatar: 'a_nouveau',
            avatar_decoration_data: { asset: 'deco' },
          }),
        ),
    );

    expect(await refreshDiscordAccounts(0)).toBe(1);
    const user = await db.user.findUniqueOrThrow({ where: { id: created.userId } });
    expect(user.avatarUrl).toContain('a_nouveau.png');
    expect(user.avatarMotionUrl).toContain('a_nouveau.gif');
    const account = await db.linkedAccount.findFirstOrThrow({
      where: { userId: created.userId },
    });
    expect(account.frameMotionUrl).toContain('deco.png');

    expect(await refreshDiscordAccounts(0)).toBe(0);
    for (const { id: accountId, lastSyncedAt } of stale) {
      await db.linkedAccount.update({ where: { id: accountId }, data: { lastSyncedAt } });
    }
  });

  it('ne touche pas au cadre du site équipé', async () => {
    const id = identity({ frameUrl: 'https://a.test/cadre.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('compte non créé');
    const where = { id: created.userId };
    await db.user.update({ where, data: { frame: 'podium-1' } });

    await resolveIdentity({ ...id, frameUrl: null }, null);
    expect((await db.user.findUniqueOrThrow({ where })).frame).toBe('podium-1');
  });
});

describe('succès cachés Steam', () => {
  it('lit leur description dans la page du joueur', () => {
    const page = String.raw`{\"api_name\":\"BOSS\",\"name\":\"On répète\",\"description\":\"Éliminer le \\\"Polyèdre\\\"\",\"hidden\":true,\"icon\":\"a.jpg\"},{\"api_name\":\"VIDE\",\"name\":\"Rien\",\"description\":\"\",\"hidden\":true}`;
    const descriptions = parseSteamPage(page);
    expect(descriptions.get('BOSS')).toBe('Éliminer le "Polyèdre"');
    expect(descriptions.has('VIDE')).toBe(false);
  });
});

describe('saison', () => {
  const season = {
    startsAt: new Date('2026-06-01T00:00:00Z'),
    endsAt: new Date('2026-07-01T00:00:00Z'),
    goal: 100,
    tiers: [100, 500, 2_000],
    burstPerSecond: 3,
    burstPerMinute: 4,
    completionBonus: 500,
  } as const;

  async function player() {
    const result = await resolveIdentity(identity(), null);
    if (!result.ok) throw new Error('compte non créé');
    return result.userId;
  }

  async function achievements(rarities: number[]) {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} saison`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    return Promise.all(
      rarities.map((globalRarity, index) =>
        db.achievement.create({
          data: { gameId: game.id, platformAchievementId: String(index), name: 'S', globalRarity },
        }),
      ),
    );
  }

  const unlockFor = (userId: string) => (achievementId: string | undefined, unlockedAt: string) =>
    db.userAchievement.create({
      data: { userId, achievementId: achievementId as string, unlockedAt: new Date(unlockedAt) },
    });

  it('compte les jeux déjà commencés', async () => {
    const userId = await player();
    const [old, rare, rarer, common] = await achievements([90, 3, 2, 90]);
    const [fresh] = await achievements([3]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await unlock(rare?.id, '2026-06-10T12:00:00Z');
    await unlock(rarer?.id, '2026-06-10T13:00:00Z');
    await unlock(common?.id, '2026-06-11T12:00:00Z');
    await unlock(fresh?.id, '2026-06-12T12:00:00Z');

    const stats = await seasonStats(season);
    // 50 + 50 + 5 ; le jeu commencé en saison ne compte pas.
    expect(stats.ranking.find((row) => row.id === userId)?.points).toBe(105);
  });

  it('écarte les rafales et le bonus du jeu qu’elles terminent', async () => {
    const userId = await player();
    const [old, ...burst] = await achievements([90, 90, 90, 90]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await Promise.all(burst.map((item) => unlock(item.id, '2026-06-10T12:00:00Z')));
    if (!old) throw new Error('succès non créé');
    await db.userGame.create({
      data: {
        userId,
        gameId: old.gameId,
        completion: 100,
        unlockedCount: 4,
        totalCount: 4,
        lastUnlockedAt: new Date('2026-06-10T12:00:00Z'),
      },
    });

    const row = (await seasonStats(season)).ranking.find((item) => item.id === userId);
    expect(row).toMatchObject({ points: 0, ignored: 3 });
  });

  it('écarte aussi les rafales étalées sur une minute', async () => {
    const userId = await player();
    const [old, a, b, c, d] = await achievements([90, 90, 90, 90, 90]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await unlock(a?.id, '2026-06-10T12:00:01Z');
    await unlock(b?.id, '2026-06-10T12:00:11Z');
    await unlock(c?.id, '2026-06-10T12:00:21Z');
    await unlock(d?.id, '2026-06-10T12:00:31Z');

    const row = (await seasonStats(season)).ranking.find((item) => item.id === userId);
    expect(row).toMatchObject({ points: 0, ignored: 4 });
  });

  it('ne montre pas le badge quand seule une version jamais commencée reste à finir', async () => {
    const userId = await player();
    const key = `${PREFIX}-${Math.random()}`;
    const [started] = await achievements([90]);
    const [other] = await achievements([90, 90]);
    if (!started || !other) throw new Error('succès non créé');
    await db.game.updateMany({
      where: { id: { in: [started.gameId, other.gameId] } },
      data: { familyKey: key },
    });
    await db.game.update({ where: { id: other.gameId }, data: { platform: 'PSN' } });
    await unlockFor(userId)(started.id, '2020-01-01T12:00:00Z');
    await db.userGame.createMany({
      data: [
        { userId, gameId: started.gameId, completion: 100, unlockedCount: 1, totalCount: 1 },
        { userId, gameId: other.gameId, completion: 0, unlockedCount: 0, totalCount: 2 },
      ],
    });

    const { games } = await listGames({ sort: 'nom', page: 1, ownerId: userId }, userId);
    expect(games[0]?.seasonEligible).toBe(false);
  });

  it('garde les succès isolés', async () => {
    const userId = await player();
    const [old, a, b] = await achievements([90, 90, 90]);
    const unlock = unlockFor(userId);
    await unlock(old?.id, '2026-05-01T12:00:00Z');
    await unlock(a?.id, '2026-06-10T12:00:00Z');
    await unlock(b?.id, '2026-06-10T12:00:00Z');

    const row = (await seasonStats(season)).ranking.find((item) => item.id === userId);
    expect(row).toMatchObject({ points: 10, ignored: 0 });
  });
});

describe('guides officiels', () => {
  const file = (text: string) => `STEAM ${PREFIX}-guides\n\n@@ A1\n${text}\n\n@@ INCONNU\nRien.\n`;

  it('lit un fichier de guides', () => {
    expect(parseGuideFile('STEAM 42\n@@ A\n## Un\n\ntexte\n\n@@ B manquable\nDeux\n')).toEqual({
      platform: 'STEAM',
      gameId: '42',
      partial: false,
      guides: [
        { achievementId: 'A', content: '## Un\n\ntexte', missable: false },
        { achievementId: 'B', content: 'Deux', missable: true },
      ],
    });
  });

  it('suit le dépôt : ajoute, met à jour, puis retire', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-guides`,
        name: `${PREFIX} guides`,
        slug: `${PREFIX}-guides`,
      },
    });
    const achievement = await db.achievement.create({
      data: { gameId: game.id, platformAchievementId: 'A1', name: 'A' },
    });
    const guides = () => db.guide.findMany({ where: { achievementId: achievement.id } });

    await syncCuratedGuides([file('Première version.')]);
    expect((await guides()).map((g) => g.contentMd)).toEqual(['Première version.']);

    await syncCuratedGuides([file('Deuxième version.')]);
    expect((await guides()).map((g) => g.contentMd)).toEqual(['Deuxième version.']);

    await syncCuratedGuides([]);
    expect(await guides()).toEqual([]);
  });

  it('publie un guide complet officiel, le met à jour, puis le retire', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-guide-complet`,
        name: `${PREFIX} guide complet`,
        slug: `${PREFIX}-guide-complet`,
      },
    });
    const gameGuide = (body: string) =>
      `STEAM ${PREFIX}-guide-complet\n\n# Le 100 % pas à pas\n\n## Étape 1\n\n${body}\n`;
    const guides = () =>
      db.guide.findMany({
        where: { gameId: game.id },
        select: { title: true, contentMd: true, curatedKey: true, achievementId: true },
      });

    await syncCuratedGuides([], [gameGuide('Finir l’histoire.')]);
    expect(await guides()).toEqual([
      {
        title: 'Le 100 % pas à pas',
        contentMd: '## Étape 1\n\nFinir l’histoire.',
        curatedKey: `STEAM:${PREFIX}-guide-complet:JEU`,
        achievementId: null,
      },
    ]);

    await syncCuratedGuides([], [gameGuide('Finir l’histoire, puis le puzzle.')]);
    expect((await guides()).map((g) => g.contentMd)).toEqual([
      '## Étape 1\n\nFinir l’histoire, puis le puzzle.',
    ]);

    await syncCuratedGuides([], []);
    expect(await guides()).toEqual([]);
  });

  it('garde la modification d’un modérateur tant que le dépôt ne change pas', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-guide-modere`,
        name: `${PREFIX} guide modéré`,
        slug: `${PREFIX}-guide-modere`,
      },
    });
    const gameGuide = (body: string) => `STEAM ${PREFIX}-guide-modere\n\n# Le 100 %\n\n${body}\n`;
    const official = () => db.guide.findFirstOrThrow({ where: { gameId: game.id } });

    await syncCuratedGuides([], [gameGuide('Version du dépôt.')]);
    const guide = await official();
    const [user, moderator] = [
      { id: `${PREFIX}-joueur`, role: 'USER' },
      { id: `${PREFIX}-moderateur`, role: 'MODERATOR' },
    ];
    expect(await editGuide(guide.id, user, { title: 'Pirate', contentMd: '…' })).toBe(false);
    expect(
      await editGuide(guide.id, moderator, { title: 'Le 100 % corrigé', contentMd: 'Corrigé.' }),
    ).toBe(true);

    // Un nouveau déploiement, fichier inchangé : la correction du site reste.
    await syncCuratedGuides([], [gameGuide('Version du dépôt.')]);
    expect(await official()).toMatchObject({ title: 'Le 100 % corrigé', contentMd: 'Corrigé.' });

    // Le dépôt change le guide : c'est lui qui l'emporte.
    await syncCuratedGuides([], [gameGuide('Nouvelle version du dépôt.')]);
    expect(await official()).toMatchObject({
      title: 'Le 100 %',
      contentMd: 'Nouvelle version du dépôt.',
    });

    await syncCuratedGuides([], []);
  });

  it('donne les guides aux autres versions du jeu, succès de même nom par succès', async () => {
    const familyKey = `${PREFIX}-famille-guides`;
    const steam = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-famille-steam`,
        name: `${PREFIX} famille`,
        slug: `${PREFIX}-famille-steam`,
        familyKey,
      },
    });
    const psn = await db.game.create({
      data: {
        platform: 'PSN',
        platformGameId: `${PREFIX}-famille-psn`,
        name: `${PREFIX} famille`,
        slug: `${PREFIX}-famille-psn`,
        familyKey,
      },
    });
    for (const [id, name] of [
      ['1', 'Mom’s Knife'],
      ['2', 'Dead God'],
    ]) {
      await db.achievement.create({ data: { gameId: steam.id, platformAchievementId: id, name } });
    }
    for (const [id, name, trophyType] of [
      ['0', 'Platinum', 'PLATINUM'],
      ['7', "MOM'S KNIFE", 'BRONZE'],
      ['8', 'Dead God', 'GOLD'],
    ] as const) {
      await db.achievement.create({
        data: { gameId: psn.id, platformAchievementId: id, name, trophyType },
      });
    }
    const head = `STEAM ${PREFIX}-famille-steam\n\n`;
    const state = async () => ({
      reviewed:
        (await db.game.findUniqueOrThrow({ where: { id: psn.id } })).guideReviewedAt !== null,
      guides: (
        await db.guide.findMany({
          where: { achievement: { gameId: psn.id } },
          select: {
            curatedKey: true,
            contentMd: true,
            achievement: { select: { missable: true } },
          },
          orderBy: { curatedKey: 'asc' },
        })
      ).map((g) => [g.curatedKey, g.contentMd, g.achievement?.missable]),
    });

    await syncCuratedGuides([`${head}@@ 1 manquable\nLe couteau.\n@@ 2\nTout finir.\n`]);
    expect(await state()).toEqual({
      reviewed: true,
      guides: [
        [`PSN:${PREFIX}-famille-psn:7`, 'Le couteau.', true],
        [`PSN:${PREFIX}-famille-psn:8`, 'Tout finir.', false],
      ],
    });

    // Un trophée sans guide de même nom : la version PSN ne vaut plus relevé complet.
    await syncCuratedGuides([`${head}@@ 1\nLe couteau.\n`]);
    expect(await state()).toEqual({
      reviewed: false,
      guides: [[`PSN:${PREFIX}-famille-psn:7`, 'Le couteau.', false]],
    });

    await syncCuratedGuides([]);
    expect(await state()).toEqual({ reviewed: false, guides: [] });
  });

  it('refuse un guide complet sans titre', () => {
    expect(() => parseGameGuideFile('STEAM 42\n\n## Pas de titre\n')).toThrow();
  });

  it('marque les manquables du jeu relevé, et les retire avec son fichier', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-manquables`,
        name: `${PREFIX} manquables`,
        slug: `${PREFIX}-manquables`,
      },
    });
    for (const id of ['M1', 'M2']) {
      await db.achievement.create({
        data: { gameId: game.id, platformAchievementId: id, name: id },
      });
    }
    const state = async () => ({
      reviewed:
        (await db.game.findUniqueOrThrow({ where: { id: game.id } })).guideReviewedAt !== null,
      missable: (await db.achievement.findMany({ where: { gameId: game.id, missable: true } })).map(
        (a) => a.platformAchievementId,
      ),
    });
    const head = `STEAM ${PREFIX}-manquables\n\n`;

    await syncCuratedGuides([`${head}@@ M1 manquable\nÀ faire avant le chapitre 3.\n`]);
    expect(await state()).toEqual({ reviewed: true, missable: ['M1'] });

    await syncCuratedGuides([`${head}@@ M1\nPlus manquable depuis un patch.\n`]);
    expect(await state()).toEqual({ reviewed: true, missable: [] });

    // Un relevé partiel signale ses manquables sans valoir relevé complet.
    await syncCuratedGuides([
      `STEAM ${PREFIX}-manquables partiel\n\n@@ M2 manquable\nUn choix de dialogue.\n`,
    ]);
    expect(await state()).toEqual({ reviewed: false, missable: ['M2'] });

    await syncCuratedGuides([`${head}@@ M2 manquable\nUn choix de dialogue.\n`]);
    await syncCuratedGuides([]);
    expect(await state()).toEqual({ reviewed: false, missable: [] });
  });
});

describe('textes officiels des succès', () => {
  it('demande une fois les textes d’un jeu, puis les affiche', async () => {
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: '424242',
        name: `${PREFIX} textes`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
      },
    });
    const achievement = await db.achievement.create({
      data: {
        gameId: game.id,
        platformAchievementId: 'BOSS',
        name: 'Le boss',
        description: 'Bats le boss',
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            game: {
              availableGameStats: {
                achievements: [{ name: 'BOSS', displayName: 'The boss', description: 'Beat it' }],
              },
            },
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await ensureGameTexts(game, 'en');
    await ensureGameTexts(game, 'en');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [text] = await localizeAchievements([achievement], 'en');
    expect(text).toMatchObject({ name: 'The boss', description: 'Beat it' });
    const [french] = await localizeAchievements([achievement], 'fr');
    expect(french?.name).toBe('Le boss');
  });
});

describe('succès du site', () => {
  async function player(handle: string) {
    return db.user.create({ data: { handle, displayName: handle } });
  }

  async function withAccount(handle: string) {
    const user = await player(handle);
    await db.linkedAccount.create({
      data: { userId: user.id, provider: 'STEAM', providerUserId: handle, displayName: handle },
    });
    return user;
  }

  it('reste muet la première fois, puis annonce la suite', async () => {
    const user = await withAccount(`${PREFIX}-succes1`);
    const heard: unknown[] = [];
    const stop = onChat(user.id, (event) => heard.push(event));

    expect(await checkSiteAchievements(user.id)).toContain('first_account');
    expect(heard).toEqual([]);
    expect(await checkSiteAchievements(user.id)).toEqual([]);

    await db.user.update({ where: { id: user.id }, data: { showcaseCustom: true } });
    expect(await checkSiteAchievements(user.id)).toEqual(['storefront']);
    expect(heard).toEqual([{ type: 'site-achievement', codes: ['storefront'] }]);

    await grantSiteAchievement(user.id, 'deserter');
    await grantSiteAchievement(user.id, 'deserter');
    expect(heard).toHaveLength(2);
    stop();
  });

  it('garde un succès acquis et le secret de celui qui ne le connaît pas', async () => {
    const owner = await withAccount(`${PREFIX}-succes2`);
    const viewer = await player(`${PREFIX}-succes3`);
    await checkSiteAchievements(owner.id);
    await grantSiteAchievement(owner.id, 'deserter');
    await db.linkedAccount.deleteMany({ where: { userId: owner.id } });
    await checkSiteAchievements(owner.id);

    const find = (board: Awaited<ReturnType<typeof siteAchievementBoard>>, category: string) =>
      board.categories.find((entry) => entry.category === category)?.items ?? [];

    const seenByViewer = await siteAchievementBoard(owner.id, viewer.id);
    expect(seenByViewer.earned).toBe(2);
    expect(seenByViewer.total).toBe(SITE_TOTAL);
    expect(find(seenByViewer, 'start')[0]?.unlockedAt).toBeTruthy();
    const hidden = find(seenByViewer, 'secret').filter((item) => item.unlockedAt);
    expect(hidden).toEqual([
      expect.objectContaining({ title: null, text: null, rarity: null, icon: UNKNOWN_ICON }),
    ]);

    const seenByOwner = await siteAchievementBoard(owner.id, owner.id);
    expect(find(seenByOwner, 'secret').filter((item) => item.title)).toHaveLength(1);
  });

  it('compte tous les joueurs, même ceux qui ne reviennent pas', async () => {
    const active = await withAccount(`${PREFIX}-succes7`);
    const absent = await withAccount(`${PREFIX}-succes8`);
    await checkSiteAchievements(active.id);

    const rate = async () => {
      const board = await siteAchievementBoard(active.id, active.id);
      const [first] = board.categories.find((entry) => entry.category === 'start')?.items ?? [];
      return first?.rarity ?? 0;
    };
    expect(await rate()).toBeLessThan(100);

    await db.siteUnlock.deleteMany({ where: { userId: absent.id } });
    await reviewNewPlayers();
    expect(await db.siteUnlock.count({ where: { userId: absent.id } })).toBeGreaterThan(0);
  });

  it('donne la part des joueurs du palier obtenu, pas du suivant', async () => {
    const owner = await withAccount(`${PREFIX}-succes-palier`);
    await db.siteUnlock.createMany({
      data: ['guild_1000', 'guild_10000'].map((code) => ({ userId: owner.id, code })),
    });
    const board = await siteAchievementBoard(owner.id, owner.id);
    const guild = board.categories
      .flatMap((entry) => entry.items)
      .find((item) => item.code === 'guild_50000');
    expect(guild?.complete).toBe(false);
    expect(guild?.rarity).toBeGreaterThan(0);
  });

  it("montre les jeux d'un autre joueur, et ses secrets seulement à qui les a aussi", async () => {
    const owner = await player(`${PREFIX}-succes9`);
    const viewer = await player(`${PREFIX}-succes10`);
    const game = await db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-succes`,
        name: `${PREFIX} preuve`,
        slug: `${PREFIX}-preuve`,
        // Classé : sans cela, un jeu Steam reste hors des preuves publiques.
        contentCheckedAt: new Date(),
      },
    });
    const proof = { games: [game.id] };
    await db.siteUnlock.createMany({
      data: [
        { userId: owner.id, code: 'cards_1', proof },
        { userId: owner.id, code: 'friday13', proof },
      ],
    });
    const items = async (viewerId: string | null) => {
      const { categories } = await siteAchievementBoard(owner.id, viewerId);
      return categories.flatMap((entry) => entry.items).filter((item) => item.unlockedAt);
    };
    const slugs = (list: Awaited<ReturnType<typeof items>>) =>
      list.map((item) => item.proof?.games[0]?.slug ?? null);

    expect(slugs(await items(viewer.id)).toSorted()).toEqual([game.slug, null].toSorted());
    expect(slugs(await items(null)).filter(Boolean)).toEqual([game.slug]);

    await db.siteUnlock.create({ data: { userId: viewer.id, code: 'friday13' } });
    expect(slugs(await items(viewer.id))).toEqual([game.slug, game.slug]);
  });

  it('accorde les dix secrets au Dernier mot', async () => {
    const user = await withAccount(`${PREFIX}-succes4`);
    await checkSiteAchievements(user.id);
    await db.siteUnlock.createMany({
      data: [
        'midnight',
        'friday13',
        'birthday',
        'grand_slam',
        'christmas',
        'new_year',
        'monk',
        'forty_two',
        'hare',
        'twins',
      ].map((code) => ({ userId: user.id, code })),
    });
    expect(await checkSiteAchievements(user.id)).toEqual(['last_word']);
  });

  const gameFor = (name: string, tags: number[] = []) =>
    db.game.create({
      data: {
        platform: 'STEAM',
        platformGameId: `${PREFIX}-${Math.random()}`,
        name: `${PREFIX} ${name}`,
        slug: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
        totalAchievements: 10,
        tags,
      },
    });
  const unique = (name: string) => `${PREFIX}-${name}-${Math.random().toString(36).slice(2, 8)}`;

  it('regroupe les paliers et propose des jeux pour avancer', async () => {
    const owner = await withAccount(unique('paliers'));
    const zombie = GENRES.zombies.tags[0];
    const near = await gameFor('zombies proche', [zombie]);
    const far = await gameFor('zombies loin', [zombie]);
    const other = await gameFor('autre');
    for (const [game, completion] of [
      [near, 80],
      [far, 20],
      [other, 90],
    ] as const) {
      await db.userGame.create({
        data: {
          userId: owner.id,
          gameId: game.id,
          completion,
          unlockedCount: completion / 10,
          totalCount: 10,
        },
      });
    }
    await db.siteUnlock.create({ data: { userId: owner.id, code: 'g_zombies_1' } });

    const { categories } = await siteAchievementBoard(owner.id, owner.id);
    const genres = categories.find((entry) => entry.category === 'genres')!;
    const zombies = genres.items.filter((item) => item.code?.startsWith('g_zombies_'));
    expect(zombies).toHaveLength(1);
    expect(zombies[0]).toMatchObject({ code: 'g_zombies_5', suggest: true, complete: false });
    expect(zombies[0]?.steps.map((step) => step.earned)).toEqual([true, false, false]);
    // La carte dit le palier obtenu, en a la couleur, et nomme le suivant.
    expect(zombies[0]).toMatchObject({
      title: m.ach_g_zombies_1_title(),
      tier: 1,
      next: { title: expect.any(String), text: expect.stringContaining('5') },
    });
    expect(zombies[0]?.steps.map((step) => step.tier)).toEqual([1, 2, 3]);
    expect(
      (await siteAchievementBoard(owner.id, null)).categories.flatMap((c) => c.items),
    ).not.toContainEqual(expect.objectContaining({ suggest: true }));

    const ideas = await siteSuggestions(owner.id, 'g_zombies_5');
    expect(ideas?.owned).toBe(true);
    expect(ideas?.games.map((game) => game.name)).toEqual([
      `${PREFIX} zombies proche`,
      `${PREFIX} zombies loin`,
    ]);
    expect(await siteSuggestions(owner.id, 'makeover')).toBeNull();
  });

  it('compte les jeux finis à deux entre amis', async () => {
    const me = await withAccount(unique('duo-a'));
    const friend = await player(unique('duo-b'));
    await db.friendship.create({
      data: { requesterId: me.id, addresseeId: friend.id, accepted: true },
    });
    const game = await gameFor('duo');
    const day = 24 * 60 * 60 * 1000;
    for (const [userId, ago] of [
      [me.id, 0],
      [friend.id, 2 * day],
    ] as const) {
      await db.userGame.create({
        data: {
          userId,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
          lastUnlockedAt: new Date(Date.now() - ago),
        },
      });
    }
    await checkSiteAchievements(me.id);
    const codes = (await db.siteUnlock.findMany({ where: { userId: me.id } })).map(
      (row) => row.code,
    );
    expect(codes).toEqual(expect.arrayContaining(['duo_1', 'revenge_1', 'teammates_1']));
    expect(codes).not.toContain('duo_5');
  });

  it('donne les succès de clan aux membres du moment, pas aux suivants', async () => {
    const [a, b, c, late] = await Promise.all(
      ['a', 'b', 'c', 'late'].map((name) => player(unique(`clan-${name}`))),
    );
    const clan = await db.clan.create({
      data: {
        name: unique('clan'),
        slug: unique('clan'),
        members: {
          create: [a!, b!, c!].map((user, index) => ({
            userId: user.id,
            role: index === 0 ? 'OWNER' : 'MEMBER',
          })),
        },
      },
    });
    const game = await gameFor('raid');
    for (const user of [a!, b!, c!]) {
      await db.userGame.create({
        data: {
          userId: user.id,
          gameId: game.id,
          completion: 100,
          unlockedCount: 10,
          totalCount: 10,
          lastUnlockedAt: new Date(),
        },
      });
    }
    // Quatre succès déjà gagnés : le cinquième apporte le premier cadre.
    await db.clanUnlock.createMany({
      data: ['guild_50000', 'band_25', 'loyal', 'marathon_100'].map((code) => ({
        clanId: clan.id,
        code,
      })),
    });
    const gained = await checkClanAchievements(clan.id);
    expect(gained).toEqual(expect.arrayContaining(['band_3', 'raid_3', 'nobody_behind']));
    expect(
      await db.clan.findUniqueOrThrow({ where: { id: clan.id }, select: { frame: true } }),
    ).toEqual({
      frame: 'clan-1',
    });
    expect(await db.userFrame.count({ where: { userId: c!.id, frame: 'clan-1' } })).toBe(1);
    expect(gained).not.toContain('raid_5');
    expect(await db.siteUnlock.count({ where: { userId: b!.id, code: 'raid_3' } })).toBe(1);

    await db.clanMember.create({ data: { userId: late!.id, clanId: clan.id } });
    await checkClanAchievements(clan.id);
    expect(await db.siteUnlock.count({ where: { userId: late!.id, code: 'raid_3' } })).toBe(0);

    const board = await clanAchievementBoard(clan.id);
    expect(board.items.find((item) => item.code.startsWith('band_'))).toMatchObject({
      code: 'band_10',
      progress: { value: 4, goal: 10 },
    });
  });
});

describe('jeton PSN du site', () => {
  const DAY = 24 * 60 * 60 * 1000;
  afterEach(async () => {
    await db.serviceToken.deleteMany();
    await db.announcement.deleteMany({ where: { key: { startsWith: 'jeton:' } } });
  });

  it('compte ses 60 jours depuis sa mise en service, et repart à zéro avec un nouveau', async () => {
    const start = new Date('2026-11-01T00:00:00Z');
    await notePsnToken('ancien', undefined, start);
    await notePsnToken('ancien', undefined, new Date(start.getTime() + 10 * DAY));

    const state = await psnTokenState(start.getTime() + 10 * DAY);
    expect(state).toMatchObject({ since: start, daysLeft: 50, failing: false, warn: false });
    expect((await psnTokenState(start.getTime() + 40 * DAY))?.warn).toBe(true);

    // L'empreinte seule est gardée : jamais le jeton.
    const row = await db.serviceToken.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('ancien');

    const later = new Date(start.getTime() + 45 * DAY);
    await notePsnToken('nouveau', undefined, later);
    expect(await psnTokenState(later.getTime())).toMatchObject({ since: later, daysLeft: 60 });
  });

  it('signale un refus de Sony, puis le lève au prochain échange réussi', async () => {
    await notePsnToken('jeton', 'Is your NPSSO code valid?');
    expect(await psnTokenState()).toMatchObject({ failing: true, warn: true });
    await notePsnToken('jeton');
    expect(await psnTokenState()).toMatchObject({ failing: false, warn: false });
  });

  it("ne prévient qu'une fois par étape", async () => {
    await notePsnToken('jeton', 'Is your NPSSO code valid?');
    await warnPsnToken();
    await warnPsnToken();
    const keys = await db.announcement.findMany({ where: { key: { startsWith: 'jeton:' } } });
    expect(keys.map((a) => a.key)).toEqual([expect.stringMatching(/^jeton:[0-9a-f]{16}:refuse$/)]);
  });
});
