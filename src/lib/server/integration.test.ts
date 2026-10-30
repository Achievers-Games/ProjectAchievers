// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveIdentity, type Identity } from './accounts';
import { db } from './db';
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
    expect(await resolveIdentity(id, other.userId)).toEqual({
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
