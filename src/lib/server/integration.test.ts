// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveIdentity, type Identity } from './accounts';
import { db } from './db';
import { mergeUsers } from './merge';
import { enqueueSync, runSync, startWorkers } from './sync/queue';
import { onSync, type SyncEvent } from './sync/events';
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
