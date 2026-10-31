// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { listGames } from './queries';
import { profileSchema, resolveIdentity, updateProfile, type Identity } from './accounts';
import { nextTier, stepOf, tierFor } from '$lib/collection';
import { db } from './db';
import { familyKey } from './family';
import { groupLibrary } from './library';
import { mergeUsers } from './merge';
import { enqueueSync, runSync, startWorkers } from './sync/queue';
import { isAdultOnly, rateGames } from './sync/content';
import { onCard, onSync, type SyncEvent } from './sync/events';
import { steamImages } from './sync/steam';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';

const PREFIX = 'zz-test';
const STEAM_ID = '76561190000000001';

const identity = (overrides: Partial<Identity> = {}): Identity => ({
  provider: 'STEAM',
  providerUserId: `${PREFIX}-${Math.random()}`,
  displayName: `${PREFIX} joueur`,
  ...overrides,
});

async function cleanup() {
  await db.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  await db.game.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

beforeAll(cleanup);
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

describe('rattachement des comptes', () => {
  it('crée un utilisateur pour une identité inconnue', async () => {
    const result = await resolveIdentity(identity(), null);
    expect(result).toMatchObject({ ok: true, created: true });
  });

  it('retrouve le même utilisateur à la connexion suivante', async () => {
    const id = identity();
    const first = await resolveIdentity(id, null);
    const second = await resolveIdentity(id, null);
    expect(second).toMatchObject({ ok: true, created: false });
    expect(first.ok && second.ok && first.userId === second.userId).toBe(true);
  });

  it('ne fusionne jamais deux personnes portant le même pseudo', async () => {
    const displayName = `${PREFIX} homonyme`;
    const victim = await resolveIdentity(identity({ displayName }), null);
    const attacker = await resolveIdentity(identity({ displayName }), null);
    expect(victim.ok && attacker.ok && victim.userId !== attacker.userId).toBe(true);
  });

  it('refuse de voler un compte déjà lié à un autre profil', async () => {
    const id = identity();
    await resolveIdentity(id, null);
    const other = await resolveIdentity(identity(), null);
    if (!other.ok) throw new Error('création attendue');
    expect(await resolveIdentity(id, other.userId)).toMatchObject({
      ok: false,
      reason: 'already_linked',
    });
  });

  it('refuse un second compte du même fournisseur', async () => {
    const first = await resolveIdentity(identity(), null);
    if (!first.ok) throw new Error('création attendue');
    expect(await resolveIdentity(identity(), first.userId)).toEqual({
      ok: false,
      reason: 'provider_taken',
    });
  });

  it('chiffre les jetons au repos', async () => {
    const id = identity({ provider: 'DISCORD', accessToken: 'jeton-en-clair' });
    await resolveIdentity(id, null);
    const row = await db.linkedAccount.findUniqueOrThrow({
      where: {
        provider_providerUserId: { provider: 'DISCORD', providerUserId: id.providerUserId },
      },
    });
    expect(row.accessTokenEnc).toBeTruthy();
    expect(row.accessTokenEnc).not.toContain('jeton-en-clair');
  });
});

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
    },
  });

  it('fixe les paliers avant le 100 %', () => {
    expect([0, 24.9, 25, 49, 50, 74, 75, 99, 100].map(stepOf)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0]);
  });

  it('réunit les versions sur la plus avancée, sans pénaliser une version finie', () => {
    const [card] = groupLibrary([row('PSN', 40), row('STEAM', 100)]);
    expect(card).toMatchObject({ slug: 'steam', tier: 1 });
    expect(card?.progress.completion).toBe(100);
    expect(card?.versions.map((v) => v.platform)).toEqual(['STEAM', 'PSN']);
  });

  it('montre le niveau suivant dès qu’une autre plateforme est commencée', () => {
    expect(nextTier([{ platform: 'STEAM', completion: 40 }])).toBeNull();
    expect(nextTier([{ platform: 'STEAM', completion: 100 }])).toBeNull();
    expect(
      nextTier([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 0 },
      ]),
    ).toBeNull();
    expect(
      nextTier([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 58 },
      ]),
    ).toEqual({ tier: 2, platform: 'PSN', completion: 58 });
    expect(
      nextTier([
        { platform: 'STEAM', completion: 100 },
        { platform: 'PSN', completion: 100 },
        { platform: 'XBOX', completion: 12 },
      ]),
    ).toEqual({ tier: 3, platform: 'XBOX', completion: 12 });
  });

  it('fait monter la carte à chaque plateforme finie', () => {
    expect(groupLibrary([row('PSN', 100), row('STEAM', 100)])).toHaveLength(1);
    expect(groupLibrary([row('PSN', 100), row('STEAM', 100)])[0]?.tier).toBe(2);
    expect(groupLibrary([row('PSN', 100, 'a'), row('STEAM', 100, 'b')])).toHaveLength(2);
    expect(tierFor(3)).toBe(3);
    expect(tierFor(4)).toBe(4);
    expect(tierFor(5)).toBe(4);
  });
});

describe('modification du profil', () => {
  const handle = () => `${PREFIX}-${Math.random().toString(36).slice(2, 8)}`;

  async function profile(overrides: Partial<Identity> = {}) {
    const created = await resolveIdentity(identity(overrides), null);
    if (!created.ok) throw new Error('création attendue');
    return created.userId;
  }

  it('garde le nom choisi après une reconnexion', async () => {
    const id = identity({ displayName: `${PREFIX} Prénom Nom`, avatarUrl: 'https://a.test/1.png' });
    const created = await resolveIdentity(id, null);
    if (!created.ok) throw new Error('création attendue');

    const newHandle = handle();
    expect(
      await updateProfile(created.userId, {
        displayName: 'Pseudo',
        handle: newHandle,
        avatarUrl: 'https://a.test/1.png',
      }),
    ).toBeNull();
    await resolveIdentity(id, null);

    expect(await db.user.findUniqueOrThrow({ where: { id: created.userId } })).toMatchObject({
      displayName: 'Pseudo',
      handle: newHandle,
    });
  });

  it('refuse un identifiant déjà pris', async () => {
    const first = await profile();
    const second = await profile();
    const { handle: taken } = await db.user.findUniqueOrThrow({ where: { id: first } });
    expect(
      await updateProfile(second, { displayName: 'Pseudo', handle: taken, avatarUrl: '' }),
    ).toBe('handle_taken');
  });

  it("refuse une image qui ne vient pas d'un compte lié", async () => {
    const userId = await profile({ avatarUrl: 'https://a.test/1.png' });
    await profile({ avatarUrl: 'https://a.test/autre.png' });
    expect(
      await updateProfile(userId, {
        displayName: 'Pseudo',
        handle: handle(),
        avatarUrl: 'https://a.test/autre.png',
      }),
    ).toBe('avatar_unknown');
  });

  it('valide le nom et le format de l’identifiant', () => {
    const valid = { displayName: '  Pseudo ', handle: 'Mon-Pseudo', avatarUrl: '' };
    expect(profileSchema.parse(valid)).toMatchObject({
      displayName: 'Pseudo',
      handle: 'mon-pseudo',
    });
    for (const bad of ['a', 'ab_cd', '-abc', 'abc-', 'a'.repeat(25), 'é-abc', '../admin']) {
      expect(profileSchema.safeParse({ ...valid, handle: bad }).success).toBe(false);
    }
    for (const bad of ['x', 'y'.repeat(33), 'nom‮inversé', 'a\nb']) {
      expect(profileSchema.safeParse({ ...valid, displayName: bad }).success).toBe(false);
    }
  });
});

describe('calcul de la progression', () => {
  async function fixture(trophyTypes: ('PLATINUM' | 'GOLD' | 'ACHIEVEMENT')[]) {
    const created = await resolveIdentity(identity(), null);
    if (!created.ok) throw new Error('création attendue');
    const game = await upsertGame({
      platform: 'PSN',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(
      game.id,
      trophyTypes.map((trophyType, i) => ({
        platformAchievementId: String(i),
        name: `T${i}`,
        description: '',
        hidden: false,
        trophyType,
      })),
    );
    return { userId: created.userId, gameId: game.id };
  }

  it('calcule la complétion et reste idempotent', async () => {
    const { userId, gameId } = await fixture(['GOLD', 'GOLD']);
    const unlock = [{ platformAchievementId: '0', unlockedAt: new Date() }];
    expect(await saveProgress(userId, gameId, unlock)).toBe(1);
    expect(await saveProgress(userId, gameId, unlock)).toBe(0);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row).toMatchObject({ unlockedCount: 1, totalCount: 2, completion: 50, platinum: false });
  });

  it('exige le trophée platine sur PSN', async () => {
    const { userId, gameId } = await fixture(['PLATINUM', 'GOLD']);
    await saveProgress(userId, gameId, [{ platformAchievementId: '1', unlockedAt: new Date() }]);
    await saveProgress(userId, gameId, [{ platformAchievementId: '0', unlockedAt: new Date() }]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row.platinum).toBe(true);
  });

  it('réserve la platine au trophée, pas au 100 %', async () => {
    const { userId, gameId } = await fixture(['ACHIEVEMENT']);
    await saveProgress(userId, gameId, [{ platformAchievementId: '0', unlockedAt: new Date() }]);
    const row = await db.userGame.findUniqueOrThrow({
      where: { userId_gameId: { userId, gameId } },
    });
    expect(row).toMatchObject({ completion: 100, platinum: false });
  });

  it('ignore un déverrouillage inconnu du catalogue', async () => {
    const { userId, gameId } = await fixture(['GOLD']);
    expect(
      await saveProgress(userId, gameId, [{ platformAchievementId: '99', unlockedAt: new Date() }]),
    ).toBe(0);
  });
});

describe('fusion de profils', () => {
  async function twoProfiles() {
    const steam = identity();
    const discord = identity({ provider: 'DISCORD' });
    const source = await resolveIdentity(steam, null);
    const target = await resolveIdentity(discord, null);
    if (!source.ok || !target.ok) throw new Error('création attendue');
    return {
      sourceId: source.userId,
      targetId: target.userId,
      merge: {
        sourceId: source.userId,
        targetId: target.userId,
        provider: steam.provider,
        providerUserId: steam.providerUserId,
      },
      steam,
    };
  }

  async function guideFor(authorId: string) {
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} jeu`,
    });
    await saveAchievements(game.id, [
      {
        platformAchievementId: '0',
        name: 'T',
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT',
      },
    ]);
    const achievement = await db.achievement.findFirstOrThrow({ where: { gameId: game.id } });
    const guide = await db.guide.create({
      data: { achievementId: achievement.id, authorId, contentMd: 'x' },
    });
    return { game, achievement, guide };
  }

  it('réunit comptes, progression et contenus puis supprime le profil absorbé', async () => {
    const { sourceId, targetId, merge, steam } = await twoProfiles();
    const { game, guide } = await guideFor(sourceId);
    await db.userGame.create({ data: { userId: sourceId, gameId: game.id } });

    expect(await mergeUsers(merge)).toBeNull();

    expect(await db.user.findUnique({ where: { id: sourceId } })).toBeNull();
    expect(await db.linkedAccount.count({ where: { userId: targetId } })).toBe(2);
    expect(await db.userGame.count({ where: { userId: targetId } })).toBe(1);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).authorId).toBe(targetId);

    const login = await resolveIdentity(steam, null);
    expect(login).toMatchObject({ ok: true, userId: targetId, created: false });
  });

  it('garde un seul vote par guide et recalcule le score', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    const { guide } = await guideFor(sourceId);
    await db.guideVote.createMany({
      data: [
        { guideId: guide.id, userId: sourceId, value: 1 },
        { guideId: guide.id, userId: targetId, value: -1 },
      ],
    });
    await db.guide.update({ where: { id: guide.id }, data: { score: 0 } });

    expect(await mergeUsers(merge)).toBeNull();

    expect(await db.guideVote.findMany({ where: { guideId: guide.id } })).toMatchObject([
      { userId: targetId, value: -1 },
    ]);
    expect((await db.guide.findUniqueOrThrow({ where: { id: guide.id } })).score).toBe(-1);
  });

  it('conserve le rôle le plus élevé et le choix de profil privé', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await db.user.update({
      where: { id: sourceId },
      data: { role: 'MODERATOR', isPublic: false },
    });

    await mergeUsers(merge);

    expect(await db.user.findUniqueOrThrow({ where: { id: targetId } })).toMatchObject({
      role: 'MODERATOR',
      isPublic: false,
    });
  });

  it('refuse deux comptes du même fournisseur et ne change rien', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    await resolveIdentity(identity({ provider: 'STEAM' }), targetId);

    expect(await mergeUsers(merge)).toBe('provider_conflict');
    expect(await db.user.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('refuse si le compte a changé de profil depuis la demande', async () => {
    const { sourceId, targetId, merge } = await twoProfiles();
    expect(await mergeUsers({ ...merge, providerUserId: 'autre' })).toBe('stale');
    expect(await mergeUsers({ ...merge, sourceId: targetId })).toBe('stale');
    expect(await db.user.findUnique({ where: { id: sourceId } })).not.toBeNull();
  });

  it('attend la fin des synchronisations', async () => {
    const { sourceId, merge } = await twoProfiles();
    await db.linkedAccount.updateMany({
      where: { userId: sourceId },
      data: { syncStatus: 'SYNCING' },
    });
    expect(await mergeUsers(merge)).toBe('sync_running');
  });
});

function steamApi(owned: unknown) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const body = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes('GetOwnedGames')) return body(owned);
    if (url.includes('GetSchemaForGame')) {
      return body({
        game: {
          availableGameStats: {
            achievements: [
              { name: 'A', displayName: 'Alpha', hidden: 0, icon: 'i', icongray: 'g' },
              { name: 'B', displayName: 'Bêta', hidden: 0, icon: 'i', icongray: 'g' },
            ],
          },
        },
      });
    }
    if (url.includes('GetGlobalAchievementPercentages')) {
      return body({
        achievementpercentages: { achievements: [{ name: 'A', percent: '42.5' }] },
      });
    }
    if (url.includes('GetPlayerAchievements')) {
      return body({
        playerstats: {
          achievements: [
            { apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 },
            { apiname: 'B', achieved: 0, unlocktime: 0 },
          ],
        },
      });
    }
    throw new Error(`Appel inattendu : ${url}`);
  });
}

const ownedGames = {
  response: {
    games: [
      {
        appid: 999001,
        name: `${PREFIX} steam`,
        playtime_forever: 90,
        rtime_last_played: 1_700_000_100,
        has_community_visible_stats: true,
      },
    ],
  },
};

async function steamUser() {
  const id = identity({ providerUserId: STEAM_ID + Math.floor(Math.random() * 1e6) });
  const created = await resolveIdentity(id, null);
  if (!created.ok) throw new Error('création attendue');
  return created.userId;
}

describe('synchronisation Steam', () => {
  it('importe jeux, succès et rareté', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('COMPLETED');
    const progress = await db.userGame.findFirstOrThrow({
      where: { userId },
      include: { game: { include: { achievements: true } } },
    });
    expect(progress).toMatchObject({ unlockedCount: 1, totalCount: 2, completion: 50 });
    expect(progress.game.achievements.find((a) => a.name === 'Alpha')?.globalRarity).toBe(42.5);
  });

  it("ne relit pas un jeu qui n'a pas été relancé", async () => {
    const fetchMock = steamApi(ownedGames);
    vi.stubGlobal('fetch', fetchMock);
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });
    fetchMock.mockClear();
    await runSync({ userId, provider: 'STEAM' });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes('GetPlayerAchievements'))).toBe(false);
  });

  it('demande à la boutique l’image des jeux récents', async () => {
    const image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/abc.jpg';
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('appdetails')
        ? new Response(JSON.stringify({ 42: { data: { header_image: image } } }))
        : new Response(null, { status: 404 }),
    );
    expect(await steamImages(42)).toEqual({ coverUrl: image, headerUrl: image });

    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }));
    expect((await steamImages(42)).headerUrl).toContain('/42/header.jpg');
  });

  it('annonce une carte quand un jeu atteint 100 %, une seule fois', async () => {
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetPlayerAchievements')
        ? new Response(
            JSON.stringify({
              playerstats: {
                achievements: [
                  { apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 },
                  { apiname: 'B', achieved: 1, unlocktime: 1_700_000_000 },
                ],
              },
            }),
          )
        : api(input),
    );
    const userId = await steamUser();
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    await runSync({ userId, provider: 'STEAM' });
    expect(events.at(-1)?.rewards).toMatchObject([
      { game: { name: `${PREFIX} steam` }, progress: { completion: 100, platinum: false } },
    ]);

    await runSync({ userId, provider: 'STEAM' });
    stop();
    expect(events.at(-1)?.rewards).toEqual([]);
  });

  it('diffuse en direct un 100 % récent, pas un ancien ni celui d’un profil privé', async () => {
    const unlockAt = (date: number) => {
      const api = steamApi(ownedGames);
      vi.stubGlobal('fetch', async (input: string | URL) =>
        String(input).includes('GetPlayerAchievements')
          ? new Response(
              JSON.stringify({
                playerstats: {
                  achievements: ['A', 'B'].map((apiname) => ({
                    apiname,
                    achieved: 1,
                    unlocktime: Math.floor(date / 1000),
                  })),
                },
              }),
            )
          : api(input),
      );
    };
    const cards: string[] = [];
    const stop = onCard((drop) => cards.push(drop.user.handle));

    unlockAt(Date.now() - 365 * 86_400_000);
    await runSync({ userId: await steamUser(), provider: 'STEAM' });
    expect(cards).toEqual([]);

    unlockAt(Date.now());
    const privateUser = await steamUser();
    await db.user.update({ where: { id: privateUser }, data: { isPublic: false } });
    await runSync({ userId: privateUser, provider: 'STEAM' });
    expect(cards).toEqual([]);

    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    stop();
    const { handle } = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(cards).toEqual([handle]);
  });

  it('ne masque que la nudité fréquente et le contenu réservé aux adultes', async () => {
    expect(isAdultOnly([1, 2, 5])).toBe(false);
    expect(isAdultOnly([])).toBe(false);
    expect(isAdultOnly([1, 3, 4, 5])).toBe(true);
    expect(isAdultOnly([4])).toBe(true);
    expect(isAdultOnly([3])).toBe(true);
  });

  it('classe les jeux Steam et les masque tant que le joueur ne les demande pas', async () => {
    const name = `${PREFIX} classement`;
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name,
    });
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            [game.platformGameId]: { data: { content_descriptors: { ids: [1, 3, 4, 5] } } },
          }),
        ),
    );
    await db.game.updateMany({
      where: { contentCheckedAt: null, NOT: { id: game.id } },
      data: { contentCheckedAt: new Date() },
    });

    expect(await rateGames(10, 0)).toBe(1);

    const filters = { q: name, sort: 'nom', page: 1 } as const;
    expect((await listGames(filters, null)).games).toEqual([]);
    expect((await listGames({ ...filters, showAdult: true }, null)).games).toHaveLength(1);
    expect(await rateGames(10, 0)).toBe(0);
  });

  it('accepte un texte hors de l’alphabet latin', async () => {
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} ゲーム 🎮`,
    });
    await saveAchievements(game.id, [
      {
        platformAchievementId: '0',
        name: 'Достижение �',
        description: '成就',
        hidden: false,
        trophyType: 'ACHIEVEMENT',
      },
    ]);
    const saved = await db.achievement.findFirstOrThrow({ where: { gameId: game.id } });
    expect(saved.name).toBe('Достижение �');
  });

  it('continue quand un seul jeu est illisible', async () => {
    const appid = 999002;
    const api = steamApi({
      response: {
        games: [
          ...ownedGames.response.games,
          { ...ownedGames.response.games[0], appid, name: `${PREFIX} cassé` },
        ],
      },
    });
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetSchemaForGame') && String(input).includes(`appid=${appid}`)
        ? new Response('pas du json')
        : api(input),
    );
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('COMPLETED');
    expect(await db.userGame.count({ where: { userId } })).toBe(1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('n’émet plus de progression après un échec', async () => {
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetOwnedGames')
        ? new Response(
            JSON.stringify({
              response: {
                games: Array.from({ length: 12 }, (_, i) => ({
                  ...ownedGames.response.games[0],
                  appid: 999100 + i,
                })),
              },
            }),
          )
        : new Response(null, { status: 403 }),
    );
    const userId = await steamUser();
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    await runSync({ userId, provider: 'STEAM' });
    stop();

    expect(events.at(-1)?.status).toBe('FAILED');
    expect(events.filter((e) => e.processed > 0)).toEqual([]);
  });

  it('explique clairement un profil privé', async () => {
    vi.stubGlobal('fetch', steamApi({ response: {} }));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('FAILED');
    expect(account.syncError).toContain('profil Steam est privé');
  });

  it('passe par la file de tâches et publie la progression', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    await startWorkers();
    const userId = await steamUser();

    const events: SyncEvent[] = [];
    const finished = new Promise<void>((resolve) => {
      const stop = onSync(userId, (event) => {
        events.push(event);
        if (event.status === 'COMPLETED' || event.status === 'FAILED') {
          stop();
          resolve();
        }
      });
    });

    expect(await enqueueSync(userId, 'STEAM')).toBe(true);
    expect(await enqueueSync(userId, 'STEAM')).toBe(false);
    await finished;

    expect(events.map((e) => e.status)).toEqual(
      expect.arrayContaining(['QUEUED', 'SYNCING', 'COMPLETED']),
    );
  });
});
