// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { PgBoss } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';
import { listGames } from './queries';
import { resolveIdentity } from './accounts';
import { type CardDrop } from '#lib/collection';
import { db } from './db';
import { globals } from './globals';
import { afterSteamSync, checkLiveGames, checkSteamPrivacy, steamDailyPass } from './sync/live';
import { fetchPlayingGames, fetchSteamSummaries } from './providers/steam';
import { enqueueSync, refreshAccounts, runSync, startWorkers } from './sync/queue';
import { artGames, isAdultOnly, rateGames, tagGames } from './sync/content';
import { markVisible, onCard, onSync, type SyncEvent } from './sync/events';
import { fetchSteamTexts, parseSteamPage, steamImages } from './sync/steam';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
import { matchTopAchievements } from './sync/steam-match';
import { PREFIX, STEAM_ID, identity, setupIntegration } from './test-helpers';

setupIntegration();

function steamApi(owned: unknown) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const body = (value: unknown) => new Response(JSON.stringify(value));
    if (url.includes('GetOwnedGames')) return body(owned);
    if (url.includes('GetRecentlyPlayedGames') || url.includes('GetTopAchievementsForGames')) {
      return body({ response: { games: [] } });
    }
    if (url.includes('GetFriendList')) return body({ friendslist: { friends: [] } });
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
  async function delayedAchievement() {
    const userId = await steamUser();
    const original = steamApi(ownedGames);
    const state = { late: false, recent: false, denied: false, reads: 0 };
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetRecentlyPlayedGames')) {
        return new Response(
          JSON.stringify({
            response: { games: state.recent ? [{ appid: 999001, playtime_forever: 90 }] : [] },
          }),
        );
      }
      if (url.includes('GetPlayerAchievements')) {
        state.reads++;
        if (state.denied) return new Response(null, { status: 403 });
        return new Response(
          JSON.stringify({
            playerstats: {
              achievements: [
                { apiname: 'A', achieved: 1, unlocktime: 1700000000 },
                { apiname: 'B', achieved: state.late ? 1 : 0, unlocktime: 1700000100 },
              ],
            },
          }),
        );
      }
      return original(input);
    });
    await runSync({ userId, provider: 'STEAM', quiet: true });
    const game = await db.userGame.findFirstOrThrow({ where: { userId } });
    expect(game.achievementsCheckedAt).not.toBeNull();
    state.late = true;
    state.reads = 0;
    return { userId, game, state };
  }

  it('relit les succès après 24 heures même si le temps de jeu reste identique', async () => {
    const { userId, game, state } = await delayedAchievement();
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(state.reads).toBe(0);
    await db.userGame.update({
      where: { userId_gameId: { userId, gameId: game.gameId } },
      data: { achievementsCheckedAt: new Date(Date.now() - 25 * 3600000) },
    });
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(state.reads).toBe(1);
    expect(await db.userGame.findFirst({ where: { userId } })).toMatchObject({
      unlockedCount: 2,
      completion: 100,
    });
  });

  it('une synchronisation explicite saute un jeu inactif déjà vérifié', async () => {
    const { userId, state } = await delayedAchievement();
    await runSync({ userId, provider: 'STEAM' });
    expect(state.reads).toBe(0);
  });

  it('saute un jeu récent inchangé déjà vérifié', async () => {
    const { userId, state } = await delayedAchievement();
    state.recent = true;
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(state.reads).toBe(0);
  });

  it('ne repousse pas la prochaine vérification après une lecture Steam échouée', async () => {
    const { userId, game, state } = await delayedAchievement();
    const old = new Date(Date.now() - 25 * 3600000);
    await db.userGame.update({
      where: { userId_gameId: { userId, gameId: game.gameId } },
      data: { achievementsCheckedAt: old },
    });
    state.denied = true;
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(
      (await db.userGame.findFirstOrThrow({ where: { userId } })).achievementsCheckedAt,
    ).toEqual(old);
    state.denied = false;
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(await db.userGame.findFirst({ where: { userId } })).toMatchObject({ unlockedCount: 2 });
  });

  it('importe 8 000 succès par petits lots sans perdre les compteurs ni répéter les annonces', async () => {
    const userId = await steamUser();
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} gros import`,
    });
    for (let start = 0; start < 8000; start += 250) {
      await db.achievement.createMany({
        data: Array.from({ length: 250 }, (_, index) => ({
          gameId: game.id,
          platformAchievementId: String(start + index),
          name: `Succès ${start + index}`,
        })),
      });
    }
    const unlockedAt = new Date('2026-01-01T12:00:00Z');
    const unlocks = Array.from({ length: 8000 }, (_, index) => ({
      platformAchievementId: String(index),
      unlockedAt,
    }));
    const imported = await saveProgress(userId, game.id, [...unlocks, unlocks[0]!]);
    expect(imported.gained).toBe(8000);
    expect(imported.fresh).toHaveLength(5);
    expect(
      await db.userGame.findUnique({ where: { userId_gameId: { userId, gameId: game.id } } }),
    ).toMatchObject({
      unlockedCount: 8000,
      totalCount: 8000,
      completion: 100,
      lastUnlockedAt: unlockedAt,
    });
    expect(await saveProgress(userId, game.id, unlocks)).toEqual({
      gained: 0,
      fresh: [],
      removed: 0,
    });
  });

  it('crée une seule fiche lors de deux imports concurrents et résout les slugs identiques', async () => {
    const input = {
      platform: 'STEAM' as const,
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} collision ${Math.random()}`,
    };
    const same = await Promise.all([upsertGame(input), upsertGame(input)]);
    expect(same[0]!.id).toBe(same[1]!.id);
    const different = await Promise.all(
      ['1', '2'].map((suffix) =>
        upsertGame({ ...input, platformGameId: `${input.platformGameId}-${suffix}` }),
      ),
    );
    expect(new Set([same[0]!.slug, ...different.map((game) => game.slug)]).size).toBe(3);
  });

  it('conserve tous les compteurs quand deux imports apportent des succès différents', async () => {
    const userId = await steamUser();
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} progression concurrente`,
    });
    await saveAchievements(
      game.id,
      ['A', 'B'].map((id) => ({
        platformAchievementId: id,
        name: id,
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT' as const,
      })),
    );
    const results = await Promise.all(
      ['A', 'B'].map((id) =>
        saveProgress(userId, game.id, [{ platformAchievementId: id, unlockedAt: new Date() }]),
      ),
    );
    expect(results.reduce((sum, result) => sum + result.gained, 0)).toBe(2);
    expect(
      await db.userGame.findUnique({ where: { userId_gameId: { userId, gameId: game.id } } }),
    ).toMatchObject({ unlockedCount: 2, totalCount: 2, completion: 100 });
  });

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

  /** Steam annonce, d'un seul appel, combien de succès le joueur a sur chaque jeu. */
  function steamWithCounts(unlocked: number) {
    const api = steamApi(ownedGames);
    return vi.fn(async (input: string | URL) =>
      String(input).includes('GetTopAchievementsForGames')
        ? new Response(
            JSON.stringify({
              response: {
                games: [
                  { appid: 999001, total_achievements: 2, achievements: Array(unlocked).fill({}) },
                ],
              },
            }),
          )
        : api(input),
    );
  }
  /**
   * Les appels d'une méthode, pour un joueur si on le précise : les joueurs des autres tests
   * restent dans la base et passent dans le suivi des absents.
   */
  const reads = (mock: ReturnType<typeof steamWithCounts>, method: string, steamId?: string) =>
    mock.mock.calls.filter(
      ([url]) => String(url).includes(method) && (!steamId || String(url).includes(steamId)),
    ).length;

  it('ne relit que les jeux dont le nombre de succès a bougé', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    // Même vérifié il y a plus d'un jour : le décompte de Steam suffit à dire que rien n'a bougé.
    await db.userGame.updateMany({
      where: { userId },
      data: { achievementsCheckedAt: new Date(Date.now() - 25 * 3_600_000) },
    });

    const same = steamWithCounts(1);
    vi.stubGlobal('fetch', same);
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(reads(same, 'GetPlayerAchievements')).toBe(0);
    // La date de vérification suit quand même, pour le jour où les décomptes manqueraient.
    const checked = (await db.userGame.findFirstOrThrow({ where: { userId } }))
      .achievementsCheckedAt;
    expect(Date.now() - (checked?.getTime() ?? 0)).toBeLessThan(60_000);

    const more = steamWithCounts(2);
    vi.stubGlobal('fetch', more);
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(reads(more, 'GetPlayerAchievements')).toBe(1);
  });

  it('ajoute sans rien lire un jeu sans succès que le site connaît déjà', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    await runSync({ userId: await steamUser(), provider: 'STEAM' });

    const none = steamWithCounts(0);
    vi.stubGlobal('fetch', none);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    expect(reads(none, 'GetPlayerAchievements')).toBe(0);
    expect(reads(none, 'GetSchemaForGame')).toBe(0);
    expect(await db.userGame.findFirstOrThrow({ where: { userId } })).toMatchObject({
      unlockedCount: 0,
      totalCount: 2,
      playtimeMinutes: 90,
    });
  });

  it('reprend le temps de jeu d’un jeu inchangé sans relire ses succès', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });

    const [game] = ownedGames.response.games;
    const longer = { response: { games: [{ ...game, playtime_forever: 150 }] } };
    const api = steamApi(longer);
    const counted = steamWithCounts(1);
    const mock = vi.fn(async (input: string | URL) =>
      String(input).includes('GetTopAchievementsForGames') ? counted(input) : api(input),
    );
    vi.stubGlobal('fetch', mock);
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(reads(mock, 'GetPlayerAchievements')).toBe(0);
    expect((await db.userGame.findFirstOrThrow({ where: { userId } })).playtimeMinutes).toBe(150);
  });

  it('reconnaît un temps de jeu gardé privé et efface celui qui ne vient pas du joueur', async () => {
    const [game] = ownedGames.response.games;
    const silent = { response: { games: [{ ...game, playtime_forever: 0 }] } };
    vi.stubGlobal('fetch', steamApi(silent));
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    // Un temps repris d'ailleurs, comme celui de la bibliothèque d'un ami sur un jeu emprunté.
    await db.userGame.updateMany({ where: { userId }, data: { playtimeMinutes: 1176 } });

    await runSync({ userId, provider: 'STEAM' });
    expect((await db.linkedAccount.findFirstOrThrow({ where: { userId } })).playtimeHidden).toBe(
      true,
    );
    expect((await db.userGame.findFirstOrThrow({ where: { userId } })).playtimeMinutes).toBe(0);

    // Le joueur rend son temps public : le site le reprend, et le réglage est oublié.
    vi.stubGlobal('fetch', steamApi(ownedGames));
    await runSync({ userId, provider: 'STEAM' });
    expect((await db.linkedAccount.findFirstOrThrow({ where: { userId } })).playtimeHidden).toBe(
      false,
    );
    expect((await db.userGame.findFirstOrThrow({ where: { userId } })).playtimeMinutes).toBe(90);
  });

  it('date aussi à leur déblocage les succès laissés par un premier import interrompu', async () => {
    vi.stubGlobal('fetch', steamApi(ownedGames));
    const userId = await steamUser();
    // Un premier essai a enregistré ce succès avant d'échouer : le compte n'a jamais abouti.
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} interrompu`,
    });
    await saveAchievements(game.id, [
      {
        platformAchievementId: 'X',
        name: `${PREFIX} X`,
        description: '',
        hidden: false,
        trophyType: 'ACHIEVEMENT',
      },
    ]);
    const unlockedAt = new Date('2024-01-01T00:00:00Z');
    await saveProgress(userId, game.id, [{ platformAchievementId: 'X', unlockedAt }]);

    await runSync({ userId, provider: 'STEAM' });

    const row = await db.userAchievement.findFirstOrThrow({
      where: { userId, achievement: { gameId: game.id } },
    });
    expect(row.createdAt).toEqual(unlockedAt);
  });

  it('retire un succès supprimé par la plateforme et rend le 100 % atteignable', async () => {
    const userId = await steamUser();
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} catalogue réduit`,
    });
    const entry = (id: string) => ({
      platformAchievementId: id,
      name: `${PREFIX} ${id}`,
      description: '',
      hidden: false,
      trophyType: 'ACHIEVEMENT' as const,
    });
    await saveAchievements(game.id, ['A', 'B', 'C'].map(entry));
    const unlockedAt = new Date('2024-01-01T00:00:00Z');
    await saveProgress(
      userId,
      game.id,
      ['A', 'B'].map((platformAchievementId) => ({ platformAchievementId, unlockedAt })),
    );
    const where = { userId_gameId: { userId, gameId: game.id } };
    expect((await db.userGame.findUniqueOrThrow({ where })).completion).toBeLessThan(100);

    // La plateforme retire « C » : le joueur, qui a tout le reste, a terminé le jeu.
    await saveAchievements(game.id, ['A', 'B'].map(entry));
    const progress = await db.userGame.findUniqueOrThrow({ where });
    expect(progress).toMatchObject({ unlockedCount: 2, totalCount: 2, completion: 100 });
    expect((await db.game.findUniqueOrThrow({ where: { id: game.id } })).totalAchievements).toBe(2);

    // Une liste amputée de plus de la moitié ressemble à une réponse incomplète : rien ne part.
    await saveAchievements(game.id, ['A', 'B', 'C', 'D', 'E'].map(entry));
    await saveAchievements(game.id, [entry('A')]);
    expect(await db.achievement.count({ where: { gameId: game.id } })).toBe(5);
    await saveAchievements(game.id, []);
    expect(await db.achievement.count({ where: { gameId: game.id } })).toBe(5);
  });

  it('évite une relecture automatique inutile juste après une vérification réussie', async () => {
    const fetchMock = steamApi(ownedGames);
    vi.stubGlobal('fetch', fetchMock);
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });
    fetchMock.mockClear();
    await runSync({ userId, provider: 'STEAM', quiet: true });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.includes('GetPlayerAchievements'))).toBe(false);
  });

  it('prend dans la bibliothèque les jeux partagés en famille, avec le temps du joueur', async () => {
    const [game] = ownedGames.response.games;
    const family = {
      appid: 999003,
      name: `${PREFIX} emprunté`,
      playtime_forever: 240,
      has_community_visible_stats: true,
      family_shared: true,
    };
    const api = steamApi({ response: { games: [game, family] } });
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      calls.push(String(input));
      return api(input);
    });
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    expect(calls.some((url) => url.includes('include_family_licenses=1'))).toBe(true);
    // La bibliothèque des amis n'est plus lue : Steam donne déjà les jeux de la famille.
    expect(calls.some((url) => url.includes('GetFriendList'))).toBe(false);
    const row = await db.userGame.findFirstOrThrow({
      where: { userId, game: { platformGameId: '999003' } },
    });
    expect(row).toMatchObject({ unlockedCount: 1, completion: 50, playtimeMinutes: 240 });
  });

  it('ne garde d’un jeu gratuit que celui qui a été lancé', async () => {
    const [game] = ownedGames.response.games;
    const free = (appid: number, playtime_forever: number) => ({
      appid,
      name: `${PREFIX} gratuit ${appid}`,
      playtime_forever,
      has_community_visible_stats: true,
    });
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('include_all_free_games=1')
        ? new Response(
            JSON.stringify({ response: { games: [game, free(999005, 30), free(999006, 0)] } }),
          )
        : api(input),
    );
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const ids = (
      await db.userGame.findMany({
        where: { userId },
        select: { game: { select: { platformGameId: true } } },
      })
    ).map((row) => row.game.platformGameId);
    expect(ids.toSorted()).toEqual(['999001', '999005']);
  });

  it('garde un jeu sans succès Steam pour son seul temps de jeu', async () => {
    const [game] = ownedGames.response.games;
    // Honkai Impact 3rd : pas de statistiques, donc aucun succès à lire.
    const statless = {
      appid: 999007,
      name: `${PREFIX} sans succès`,
      playtime_forever: 600,
      rtime_last_played: 1_700_000_200,
    };
    const library = { response: { games: [game, statless] } };
    const api = steamApi(library);
    vi.stubGlobal('fetch', api);
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const row = await db.userGame.findFirstOrThrow({
      where: { userId, game: { platformGameId: '999007' } },
      include: { game: true },
    });
    expect(row).toMatchObject({
      unlockedCount: 0,
      totalCount: 0,
      completion: 0,
      playtimeMinutes: 600,
    });
    expect(row.game.totalAchievements).toBe(0);
    expect(row.game.schemaSyncedAt).not.toBeNull();
    const achievementReads = (mock: typeof api) =>
      mock.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes('api.steampowered.com') && url.includes('999007'));
    expect(achievementReads(api)).toEqual([]);

    // Le temps de jeu suit, toujours sans rien demander de ses succès.
    statless.playtime_forever = 660;
    const again = steamApi(library);
    vi.stubGlobal('fetch', again);
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(achievementReads(again)).toEqual([]);
    expect(
      (
        await db.userGame.findFirstOrThrow({
          where: { userId, game: { platformGameId: '999007' } },
        })
      ).playtimeMinutes,
    ).toBe(660);
  });

  it('garde la synchronisation si les décomptes de Steam échouent', async () => {
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('GetTopAchievementsForGames')
        ? new Response('', { status: 403 })
        : api(input),
    );
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('COMPLETED');
  });

  it('préfère la vignette de la boutique même si l’ancien CDN répond', async () => {
    const image = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/abc.jpg';
    vi.stubGlobal('fetch', async (input: string | URL) =>
      String(input).includes('appdetails')
        ? new Response(JSON.stringify({ 42: { data: { header_image: image } } }))
        : new Response(null, { status: 200 }),
    );
    expect(await steamImages(42)).toEqual({
      coverUrl: expect.stringContaining('/42/library_600x900.jpg'),
      headerUrl: image,
    });

    vi.stubGlobal('fetch', async () => new Response(null, { status: 200 }));
    expect((await steamImages(42)).headerUrl).toContain('/42/header.jpg');
  });

  it('fait arriver en direct un succès du jeu lancé', async () => {
    const unlocked = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    let steamid = '';
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) => {
      if (String(input).includes('GetPlayerSummaries')) {
        return new Response(
          JSON.stringify({ response: { players: [{ steamid, gameid: '999001' }] } }),
        );
      }
      return String(input).includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    const userId = await steamUser();
    steamid = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    await runSync({ userId, provider: 'STEAM' });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);

    unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await checkLiveGames();
    await checkLiveGames();
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'COMPLETED', achievements: 1, quiet: true });
  });

  it('suit aussi un joueur absent : lancement daté, succès lus toutes les 5 min et à la fermeture', async () => {
    const unlocked = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    const asked: string[] = [];
    let steamid = '';
    let gameid: string | undefined = '999001';
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      asked.push(url);
      if (url.includes('GetPlayerSummaries')) {
        return new Response(JSON.stringify({ response: { players: [{ steamid, gameid }] } }));
      }
      return url.includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    // Le joueur n'a aucune page du site ouverte : il n'est pas suivi comme un joueur présent.
    const userId = await steamUser();
    steamid = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    await runSync({ userId, provider: 'STEAM' });
    await db.userGame.updateMany({ where: { userId }, data: { lastPlayedAt: null } });
    // Seuls ses appels comptent : les joueurs des autres tests passent aussi dans le suivi.
    const achievementReads = () =>
      asked.filter((url) => url.includes('GetPlayerAchievements') && url.includes(steamid));
    const unlocks = () => db.userAchievement.count({ where: { userId } });

    // Il joue : le lancement est daté, ses succès sont lus une première fois.
    const before = Date.now();
    asked.length = 0;
    await checkLiveGames();
    const row = await db.userGame.findFirstOrThrow({
      where: { userId, game: { platformGameId: '999001' } },
      select: { lastPlayedAt: true },
    });
    expect(row.lastPlayedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(achievementReads()).toHaveLength(1);
    expect(await unlocks()).toBe(1);

    // Steam garde sa réponse quelques secondes en cache : l'horloge avance d'une minute à chaque
    // passage, comme en vrai.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      // La minute suivante, toujours en jeu : ses succès ne sont pas relus avant 5 minutes.
      vi.setSystemTime(Date.now() + 61_000);
      asked.length = 0;
      await checkLiveGames();
      expect(achievementReads()).toEqual([]);

      // Il ferme le jeu : une dernière lecture rattrape le succès gagné juste avant.
      unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
      gameid = undefined;
      vi.setSystemTime(Date.now() + 61_000);
      asked.length = 0;
      await checkLiveGames();
      expect(achievementReads()).toHaveLength(1);
      expect(await unlocks()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rattrape un succès tombé après la fermeture du jeu', async () => {
    const unlocked = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    let recents: unknown[] = [];
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      // Le jeu est fermé : Steam ne dit plus lequel tourne.
      if (url.includes('GetPlayerSummaries')) {
        return new Response(JSON.stringify({ response: { players: [] } }));
      }
      if (url.includes('GetRecentlyPlayedGames')) {
        return new Response(JSON.stringify({ response: { games: recents } }));
      }
      // Steam annonce le nombre de succès obtenus : c'est lui qui désigne les jeux à relire.
      if (url.includes('GetTopAchievementsForGames')) {
        const achievements = unlocked.map(() => ({}));
        return new Response(
          JSON.stringify({
            response: { games: [{ appid: 999001, total_achievements: 2, achievements }] },
          }),
        );
      }
      return url.includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);

    // Le joueur a débloqué un succès puis fermé le jeu : seul le temps de jeu a bougé.
    recents = [{ appid: 999001, playtime_forever: 120 }];
    unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await checkLiveGames();
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'COMPLETED', achievements: 1, quiet: true });
    // La page du joueur peut fêter le succès tout de suite : elle reçoit son titre et sa vignette.
    expect(events[0].unlocks).toMatchObject([
      { title: 'Bêta', icon: 'i', game: `${PREFIX} steam` },
    ]);
  });

  it('rattrape un succès Steam publié en retard sans changement du temps de jeu', async () => {
    const unlocked = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    let recents: unknown[] = [];
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      // Le jeu est fermé : Steam ne dit plus lequel tourne.
      if (url.includes('GetPlayerSummaries')) {
        return new Response(JSON.stringify({ response: { players: [] } }));
      }
      if (url.includes('GetRecentlyPlayedGames')) {
        return new Response(JSON.stringify({ response: { games: recents } }));
      }
      // Steam annonce le nombre de succès obtenus : c'est lui qui désigne les jeux à relire.
      if (url.includes('GetTopAchievementsForGames')) {
        const achievements = unlocked.map(() => ({}));
        return new Response(
          JSON.stringify({
            response: { games: [{ appid: 999001, total_achievements: 2, achievements }] },
          }),
        );
      }
      return url.includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);

    await db.userGame.updateMany({
      where: { userId },
      data: { achievementsCheckedAt: new Date() },
    });
    recents = [{ appid: 999001, playtime_forever: 90 }];
    unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await checkLiveGames();
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'COMPLETED', achievements: 1, quiet: true });
    // La page du joueur peut fêter le succès tout de suite : elle reçoit son titre et sa vignette.
    expect(events[0].unlocks).toMatchObject([
      { title: 'Bêta', icon: 'i', game: `${PREFIX} steam` },
    ]);
  });

  it('ne relit pas un jeu récent dont le nombre de succès n’a pas bougé', async () => {
    const api = steamApi(ownedGames);
    const mock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetPlayerSummaries')) {
        return new Response(JSON.stringify({ response: { players: [] } }));
      }
      if (url.includes('GetRecentlyPlayedGames')) {
        return new Response(
          JSON.stringify({ response: { games: [{ appid: 999001, playtime_forever: 200 }] } }),
        );
      }
      return api(input);
    });
    vi.stubGlobal('fetch', mock);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    const { unlockedCount } = await db.userGame.findFirstOrThrow({ where: { userId } });
    mock.mockClear();
    const counted = vi.fn(async (input: string | URL) =>
      String(input).includes('GetTopAchievementsForGames')
        ? new Response(
            JSON.stringify({
              response: {
                games: [
                  {
                    appid: 999001,
                    total_achievements: 2,
                    achievements: Array(unlockedCount).fill({}),
                  },
                ],
              },
            }),
          )
        : mock(input),
    );
    vi.stubGlobal('fetch', counted);
    const stop = onSync(userId, () => {});
    markVisible(userId);
    await checkLiveGames();
    stop();

    expect(reads(counted, 'GetPlayerAchievements')).toBe(0);
    // Le temps de jeu, lui, suit sans appel de plus.
    expect((await db.userGame.findFirstOrThrow({ where: { userId } })).playtimeMinutes).toBe(200);
  });

  it('relance la synchronisation dès que le joueur rend son temps de jeu public', async () => {
    let library = { response: { games: [{ appid: 999001, playtime_forever: 0 }] } };
    const api = steamApi(ownedGames);
    const mock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetPlayerSummaries')) {
        return new Response(JSON.stringify({ response: { players: [] } }));
      }
      // L'appel léger de la vérification : sans le nom des jeux.
      if (url.includes('GetOwnedGames') && !url.includes('include_appinfo')) {
        return new Response(JSON.stringify(library));
      }
      return api(input);
    });
    vi.stubGlobal('fetch', mock);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    await db.linkedAccount.updateMany({ where: { userId }, data: { playtimeHidden: true } });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);

    try {
      // Encore privé : rien ne repart, et les jeux récents, muets, ne sont pas demandés.
      await checkLiveGames();
      expect(events).toHaveLength(0);
      expect(reads(mock, 'GetRecentlyPlayedGames')).toBe(0);

      // Rendu public : la synchronisation complète part à son retour sur le site.
      library = { response: { games: [{ appid: 999001, playtime_forever: 90 }] } };
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 11 * 60_000);
      markVisible(userId);
      await checkLiveGames();
      expect(events.map((event) => event.status)).toContain('QUEUED');
    } finally {
      vi.useRealTimers();
      stop();
    }
  });

  it('la fenêtre « temps privé » voit le changement sans attendre, et ne lit que quelques jeux', async () => {
    let playtime = 0;
    const api = steamApi(ownedGames);
    const mock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetOwnedGames') && !url.includes('include_appinfo')) {
        const games = [{ appid: 999001, playtime_forever: playtime }];
        return new Response(JSON.stringify({ response: { games } }));
      }
      return api(input);
    });
    vi.stubGlobal('fetch', mock);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    await db.linkedAccount.updateMany({ where: { userId }, data: { playtimeHidden: true } });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    const probes = () =>
      mock.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes('GetOwnedGames') && !url.includes('include_appinfo'));

    try {
      expect(await checkSteamPrivacy(userId)).toBe(false);
      // Seuls les jeux où le joueur a des succès sont demandés.
      expect(probes()[0]).toContain('appids_filter');
      // Une seconde fenêtre ouverte dans la foulée ne réinterroge pas Steam.
      await checkSteamPrivacy(userId);
      expect(probes()).toHaveLength(1);
      expect(events).toHaveLength(0);

      playtime = 90;
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 5_000);
      expect(await checkSteamPrivacy(userId)).toBe(true);
      expect(events.map((event) => event.status)).toContain('QUEUED');
    } finally {
      vi.useRealTimers();
      stop();
    }
  });

  it('profil ou détails des jeux privés : la synchronisation repart dès que Steam les montre', async () => {
    let library: unknown = { response: {} };
    const api = steamApi(ownedGames);
    const mock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetOwnedGames') && !url.includes('include_appinfo')) {
        return new Response(JSON.stringify(library));
      }
      return api(input);
    });
    vi.stubGlobal('fetch', mock);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    // La dernière synchronisation a trouvé la bibliothèque cachée.
    await db.linkedAccount.updateMany({
      where: { userId },
      data: { syncStatus: 'FAILED', syncError: 'sync_steam_private' },
    });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    try {
      expect(await checkSteamPrivacy(userId)).toBe(false);
      expect(events).toHaveLength(0);

      // Bibliothèque visible, même sans temps de jeu : ce qui manquait est réglé.
      library = { response: { games: [{ appid: 999001, playtime_forever: 0 }] } };
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 5_000);
      expect(await checkSteamPrivacy(userId)).toBe(true);
      expect(events.map((event) => event.status)).toContain('QUEUED');
    } finally {
      vi.useRealTimers();
      stop();
    }
  });

  it('rendu public pendant une synchronisation : une autre part dès sa fin', async () => {
    const api = steamApi(ownedGames);
    const mock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('GetOwnedGames') && !url.includes('include_appinfo')) {
        const games = [{ appid: 999001, playtime_forever: 90 }];
        return new Response(JSON.stringify({ response: { games } }));
      }
      return api(input);
    });
    vi.stubGlobal('fetch', mock);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    // La synchronisation de la reliaison tourne encore, et a déjà vu le temps privé.
    await db.linkedAccount.updateMany({
      where: { userId },
      data: { playtimeHidden: true, syncStatus: 'SYNCING' },
    });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    try {
      expect(await checkSteamPrivacy(userId)).toBe(true);
      expect(events).toHaveLength(0);

      await db.linkedAccount.updateMany({ where: { userId }, data: { syncStatus: 'COMPLETED' } });
      await afterSteamSync(userId);
      expect(events.map((event) => event.status)).toContain('QUEUED');
    } finally {
      stop();
    }
  });

  /** Un compte Steam synchronisé, puis une API Steam réglable pour le suivi en direct. */
  async function liveUser(steam: (url: string) => Response | undefined) {
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', api);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    const mock = vi.fn(async (input: string | URL) => steam(String(input)) ?? api(input));
    vi.stubGlobal('fetch', mock);
    return { userId, mock };
  }
  const json = (value: unknown) => new Response(JSON.stringify(value));
  const nobodyPlaying = (url: string) =>
    url.includes('GetPlayerSummaries') ? json({ response: { players: [] } }) : undefined;

  it('sert un même résumé Steam au suivi en direct et à la page « jeu en cours »', async () => {
    const steamId = `${STEAM_ID}${Math.floor(Math.random() * 1e6)}`;
    const mock = vi.fn(async () =>
      json({ response: { players: [{ steamid: steamId, gameid: '999001' }] } }),
    );
    vi.stubGlobal('fetch', mock);
    expect((await fetchSteamSummaries([steamId])).get(steamId)?.gameId).toBe('999001');
    expect((await fetchPlayingGames([steamId])).get(steamId)).toBe('999001');
    expect(mock).toHaveBeenCalledTimes(1);
    // Une réponse trop vieille pour qui la demande fraîche part de nouveau chez Steam.
    await fetchPlayingGames([steamId], 0);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('ne suit que le jeu en cours d’un onglet resté en arrière-plan', async () => {
    const { userId, mock } = await liveUser(nobodyPlaying);
    const stop = onSync(userId, () => {});
    // La page est ouverte, mais elle n'a pas signalé d'onglet visible. Le premier passage est
    // l'arrivée ; ensuite, plus rien que le jeu en cours, même après les 5 min du cadre.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await checkLiveGames();
      mock.mockClear();
      vi.setSystemTime(Date.now() + 6 * 60_000);
      await checkLiveGames();
    } finally {
      vi.useRealTimers();
      stop();
    }
    const methods = mock.mock.calls.map(([url]) => /\/(\w+)\/v\d/.exec(String(url))?.[1]);
    expect(new Set(methods)).toEqual(new Set(['GetPlayerSummaries']));
  });

  it('importe seul un jeu neuf lancé par le joueur, sans synchronisation complète', async () => {
    const steamid = { value: '' };
    const neuf = { appid: 999777, name: `${PREFIX} neuf`, has_community_visible_stats: true };
    const { userId, mock } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({ response: { players: [{ steamid: steamid.value, gameid: '999777' }] } });
      }
      if (url.includes('GetOwnedGames')) {
        return json({ response: { games: [...ownedGames.response.games, neuf] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        return json({ response: { games: [{ appid: 999777, total_achievements: 2 }] } });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);
    await checkLiveGames();
    stop();

    const added = await db.userGame.findFirst({
      where: { userId, game: { platformGameId: '999777' } },
      select: { totalCount: true },
    });
    expect(added?.totalCount).toBe(2);
    expect(events.map((event) => event.status)).not.toContain('QUEUED');
    // La bibliothèque, filtrée sur ce jeu, donne son nom : rien de plus.
    expect(reads(mock, 'GetOwnedGames')).toBe(1);
  });

  it('laisse de côté un jeu lancé que la bibliothèque ne liste pas, sans synchronisation complète', async () => {
    const steamid = { value: '' };
    const { userId } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({ response: { players: [{ steamid: steamid.value, gameid: '999778' }] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        return json({ response: { games: [{ appid: 999778, total_achievements: 2 }] } });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);
    await checkLiveGames();
    stop();

    const added = await db.userGame.findFirst({
      where: { userId, game: { platformGameId: '999778' } },
    });
    expect(added).toBeNull();
    expect(events.map((event) => event.status)).not.toContain('QUEUED');
  });

  it('importe tout de suite un jeu gratuit que la bibliothèque ne liste pas encore', async () => {
    const steamid = { value: '' };
    const { userId, mock } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({ response: { players: [{ steamid: steamid.value, gameid: '999780' }] } });
      }
      if (url.includes('GetOwnedGames') && url.includes('appids_filter')) {
        return json({ response: { game_count: 0 } });
      }
      if (url.includes('appdetails')) {
        return json({
          999780: { success: true, data: { name: `${PREFIX} gratuit`, is_free: true } },
        });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        return json({ response: { games: [{ appid: 999780, total_achievements: 2 }] } });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const stop = onSync(userId, () => {});
    markVisible(userId);
    await checkLiveGames();
    stop();

    const added = await db.userGame.findFirst({
      where: { userId, game: { platformGameId: '999780' } },
      select: { totalCount: true, game: { select: { name: true } } },
    });
    expect(added).toMatchObject({ totalCount: 2, game: { name: `${PREFIX} gratuit` } });
    expect(reads(mock, 'GetOwnedGames')).toBe(1);
  });

  it('n’importe pas un jeu récent que la bibliothèque ne liste pas', async () => {
    const prete = { appid: 999781, name: `${PREFIX} prêté`, playtime_forever: 40 };
    const { userId } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) return json({ response: { players: [] } });
      if (url.includes('GetRecentlyPlayedGames')) return json({ response: { games: [prete] } });
      if (url.includes('GetOwnedGames') && url.includes('appids_filter')) {
        return json({ response: { game_count: 0 } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        return json({ response: { games: [{ appid: 999781, total_achievements: 2 }] } });
      }
    });
    const stop = onSync(userId, () => {});
    markVisible(userId);
    await checkLiveGames();
    stop();
    expect(
      await db.userGame.findFirst({ where: { userId, game: { platformGameId: '999781' } } }),
    ).toBeNull();
  });

  it('ne coûte qu’un appel par passage pour un jeu en cours sans nouveau succès', async () => {
    const steamid = { value: '' };
    const { userId, mock } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({ response: { players: [{ steamid: steamid.value, gameid: '999001' }] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        const achievements = [{ statid: 1, bit: 0, name: 'Alpha', icon: 'i' }];
        return json({
          response: { games: [{ appid: 999001, total_achievements: 2, achievements }] },
        });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const stop = onSync(userId, () => {});
    // Onglet en arrière-plan : seule la boucle des 10 s tourne, trois fois de suite.
    for (let pass = 0; pass < 3; pass++) await checkLiveGames();
    stop();
    expect(reads(mock, 'GetPlayerAchievements', steamid.value)).toBe(0);
    expect(reads(mock, 'GetTopAchievementsForGames', steamid.value)).toBe(3);
  });

  it('attend la date Steam officielle avant de compter et annoncer un succès en direct', async () => {
    const steamid = { value: '' };
    const player = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    const top: { statid: number; bit: number; name: string; icon: string }[] = [];
    const { userId } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({ response: { players: [{ steamid: steamid.value, gameid: '999001' }] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        return json({
          response: { games: [{ appid: 999001, total_achievements: 2, achievements: top }] },
        });
      }
      if (url.includes('GetPlayerAchievements')) {
        return json({ playerstats: { achievements: player } });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));
    markVisible(userId);

    // Steam voit « Bêta » ; GetPlayerAchievements, en retard, ne montre encore qu'« Alpha ».
    top.push({ statid: 1, bit: 0, name: 'Alpha', icon: 'i' });
    top.push({ statid: 1, bit: 1, name: 'Bêta', icon: 'i' });
    await checkLiveGames();
    expect(events.find((event) => event.status === 'COMPLETED')).toBeUndefined();
    const beta = await db.achievement.findFirstOrThrow({
      where: { game: { platformGameId: '999001' }, platformAchievementId: 'B' },
    });
    // Reconnu par son nom (les deux icônes sont les mêmes), sa position est retenue.
    expect(beta.steamStatBit).toBe(33);
    const provisional = await db.userAchievement.findFirst({
      where: { userId, achievementId: beta.id },
    });
    expect(provisional).toBeNull();

    // GetPlayerAchievements rattrape : le succès entre avec l'heure officielle.
    player.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await checkLiveGames();
    stop();
    const exact = await db.userAchievement.findFirstOrThrow({
      where: { userId, achievementId: beta.id },
    });
    expect(exact.unlockedAt.getTime()).toBe(1_700_000_100_000);
    expect(events.filter((event) => event.status === 'COMPLETED')).toHaveLength(1);
    expect(events.find((event) => event.status === 'COMPLETED')).toMatchObject({ achievements: 1 });
  });

  it('suit l’avatar, le cadre et l’avatar animé changés sur Steam', async () => {
    const steamid = { value: '' };
    const { userId } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({
          response: { players: [{ steamid: steamid.value, avatarfull: 'https://a/neuf.jpg' }] },
        });
      }
      if (url.includes('GetProfileItemsEquipped')) {
        return json({
          response: {
            avatar_frame: { image_small: 'cadre.png', image_large: 'cadre-grand.png' },
            animated_avatar: { image_small: 'anime.webm' },
          },
        });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const stop = onSync(userId, () => {});
    markVisible(userId);
    await checkLiveGames();
    stop();

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.avatarUrl).toBe('https://a/neuf.jpg');
    expect(account.frameUrl).toContain('cadre-grand.png');
    expect(account.avatarMotionUrl).toContain('anime.webm');
  });

  it('relit l’avatar animé dès que l’avatar change, et le cadre toutes les 5 min', async () => {
    const steamid = { value: '' };
    const avatar = { value: 'https://a/ancien.jpg' };
    const { userId, mock } = await liveUser((url) => {
      if (url.includes('GetPlayerSummaries')) {
        return json({
          response: { players: [{ steamid: steamid.value, avatarfull: avatar.value }] },
        });
      }
      if (url.includes('GetProfileItemsEquipped')) {
        return json({ response: { animated_avatar: { image_small: 'anime.webm' } } });
      }
    });
    steamid.value = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const stop = onSync(userId, () => {});
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      markVisible(userId);
      await checkLiveGames(); // arrivée
      mock.mockClear();

      vi.setSystemTime(Date.now() + 10_000);
      markVisible(userId);
      await checkLiveGames();
      expect(reads(mock, 'GetProfileItemsEquipped')).toBe(0);

      avatar.value = 'https://a/neuf.jpg';
      vi.setSystemTime(Date.now() + 10_000);
      markVisible(userId);
      await checkLiveGames();
      expect(reads(mock, 'GetProfileItemsEquipped')).toBe(1);

      vi.setSystemTime(Date.now() + 5 * 60_000);
      markVisible(userId);
      await checkLiveGames();
      expect(reads(mock, 'GetProfileItemsEquipped')).toBe(2);
    } finally {
      vi.useRealTimers();
      stop();
    }
    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account).toMatchObject({ avatarUrl: 'https://a/neuf.jpg' });
    expect(account.avatarMotionUrl).toContain('anime.webm');
  });

  it('rattrape un joueur absent par la tournée du jour, sans synchronisation complète', async () => {
    const unlocked = [{ apiname: 'A', achieved: 1, unlocktime: 1_700_000_000 }];
    const { userId, mock } = await liveUser((url) => {
      if (url.includes('GetRecentlyPlayedGames')) {
        return json({ response: { games: [{ appid: 999001, playtime_forever: 95 }] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        const achievements = unlocked.map(() => ({}));
        return json({
          response: { games: [{ appid: 999001, total_achievements: 2, achievements }] },
        });
      }
      if (url.includes('GetPlayerAchievements')) {
        return json({ playerstats: { achievements: unlocked } });
      }
    });
    unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await steamDailyPass(userId);

    const row = await db.userGame.findFirstOrThrow({ where: { userId } });
    expect(row.unlockedCount).toBe(2);
    // Une seule relecture, celle du jeu qui a bougé : la bibliothèque n'a été lue qu'une fois.
    expect(reads(mock, 'GetPlayerAchievements')).toBe(1);
    expect(reads(mock, 'GetOwnedGames')).toBe(1);
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
    markVisible(userId);

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
    const cards: CardDrop[] = [];
    const stop = onCard((drop) => cards.push(drop));

    unlockAt(Date.now() - 365 * 86_400_000);
    await runSync({ userId: await steamUser(), provider: 'STEAM' });
    expect(cards).toEqual([]);

    unlockAt(Date.now());
    const privateUser = await steamUser();
    await db.user.update({ where: { id: privateUser }, data: { isPublic: false } });
    await runSync({ userId: privateUser, provider: 'STEAM' });
    expect(cards).toEqual([]);

    const userId = await steamUser();
    await db.game.updateMany({
      where: { players: { some: { userId: privateUser } } },
      data: { contentCheckedAt: null },
    });
    await runSync({ userId, provider: 'STEAM' });
    expect(cards).toEqual([]);

    const rated = await steamUser();
    await db.game.updateMany({
      where: { players: { some: { userId: privateUser } } },
      data: { contentCheckedAt: new Date() },
    });
    await runSync({ userId: rated, provider: 'STEAM' });
    stop();
    const { handle } = await db.user.findUniqueOrThrow({ where: { id: rated } });
    // La carte diffusée porte tout ce qu'affiche le fil : son niveau et ses exemplaires.
    expect(cards).toMatchObject([
      {
        user: { handle },
        game: { name: `${PREFIX} steam`, tier: expect.any(Number) },
        copies: 1,
      },
    ]);
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

  it('lit les genres des jeux Steam, et les prête aux autres plateformes', async () => {
    const appId = String(900_000_000 + Math.floor(Math.random() * 1_000_000));
    const steam = await upsertGame({
      platform: 'STEAM',
      platformGameId: appId,
      name: `${PREFIX} Peur`,
    });
    const sibling = await upsertGame({
      platform: 'PSN',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} Peur`,
    });
    const found = await upsertGame({
      platform: 'XBOX',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} Mignon`,
    });
    const lost = await upsertGame({
      platform: 'XBOX',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} Introuvable`,
    });
    const cuteId = appId + '1';
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('storesearch')) {
        const hit = url.includes('Mignon')
          ? [{ id: Number(cuteId), name: `${PREFIX} Mignon™` }]
          : [];
        return new Response(JSON.stringify({ items: hit }));
      }
      const items = [
        {
          appid: Number(appId),
          tags: [
            { tagid: 492, weight: 50 },
            { tagid: 1667, weight: 900 },
          ],
          // L'éditeur range ses captures : la première, pas la première reçue.
          screenshots: {
            all_ages_screenshots: [
              { filename: `steam/apps/${appId}/ss_deux.jpg?t=1`, ordinal: 2 },
              { filename: `steam/apps/${appId}/ss_une.jpg?t=1`, ordinal: 1 },
            ],
          },
        },
        {
          appid: Number(cuteId),
          tags: [{ tagid: 4726, weight: 300 }],
          // Le fond de la page boutique, composé pour passer derrière du texte, passe avant les captures.
          screenshots: { all_ages_screenshots: [{ filename: `steam/apps/${cuteId}/ss.jpg` }] },
          assets: {
            asset_url_format: `steam/apps/${cuteId}/${'${FILENAME}'}?t=2`,
            raw_page_background: 'abc/page_bg_raw.jpg',
            library_hero: 'def/library_hero.jpg',
          },
        },
      ];
      return new Response(JSON.stringify({ response: { store_items: items } }));
    });
    await db.game.updateMany({
      where: { tagsCheckedAt: null, id: { notIn: [steam.id, sibling.id, found.id, lost.id] } },
      data: { tagsCheckedAt: new Date() },
    });

    expect(await tagGames(10, 0)).toBe(4);

    const tags = async (id: string) =>
      (await db.game.findUniqueOrThrow({ where: { id }, select: { tags: true } })).tags;
    expect(await tags(steam.id)).toEqual([1667, 492]);
    expect(await tags(sibling.id)).toEqual([1667, 492]);
    expect(await tags(found.id)).toEqual([4726]);
    expect(await tags(lost.id)).toEqual([]);
    expect(await tagGames(10, 0)).toBe(0);

    const art = async (id: string) =>
      (await db.game.findUniqueOrThrow({ where: { id }, select: { artUrl: true } })).artUrl;
    const screenshot = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/ss_une.1920x1080.jpg?t=1`;
    expect(await art(steam.id)).toBe(screenshot);
    expect(await art(sibling.id)).toBe(screenshot);
    expect(await art(found.id)).toBe(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${cuteId}/abc/page_bg_raw.jpg?t=2`,
    );
    // Le bandeau de bibliothèque, pour les bannières, à son adresse à empreinte.
    const { heroUrl } = await db.game.findUniqueOrThrow({
      where: { id: found.id },
      select: { heroUrl: true },
    });
    expect(heroUrl).toBe(
      `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${cuteId}/def/library_hero.jpg?t=2`,
    );

    // Les jeux classés avant l'arrivée des captures les reçoivent une fois, sans perdre leurs genres.
    await db.game.updateMany({
      where: { id: { in: [steam.id, sibling.id] } },
      data: { artUrl: null, artCheckedAt: null },
    });
    await db.game.updateMany({
      where: { artCheckedAt: null, id: { notIn: [steam.id, sibling.id] } },
      data: { artCheckedAt: new Date() },
    });
    expect(await artGames(10, 0)).toBe(2);
    expect(await art(sibling.id)).toBe(screenshot);
    expect(await tags(sibling.id)).toEqual([1667, 492]);
    expect(await artGames(10, 0)).toBe(0);
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
    expect(account.syncError).toBe('sync_steam_private');
  });

  it('ne prend pas une bibliothèque publique mais vide pour un profil privé', async () => {
    vi.stubGlobal('fetch', steamApi({ response: { game_count: 0 } }));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncError).toBeNull();
    expect(account.syncStatus).not.toBe('FAILED');
  });

  it('passe par la file de tâches et publie la progression', async () => {
    // Une erreur d'envoi après l'écriture du statut doit annuler toute la transaction.
    await startWorkers();
    const retryUser = await steamUser();
    const instance = await globals.paBoss!;
    const send = vi.spyOn(instance, 'send').mockRejectedValueOnce(new Error('file indisponible'));
    try {
      await expect(enqueueSync(retryUser, 'STEAM')).rejects.toThrow('file indisponible');
      expect(
        await db.linkedAccount.findUnique({
          where: { userId_provider: { userId: retryUser, provider: 'STEAM' } },
        }),
      ).toMatchObject({ syncStatus: 'IDLE' });
    } finally {
      send.mockRestore();
    }
    vi.stubGlobal('fetch', steamApi(ownedGames));
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

describe('succès cachés Steam', () => {
  const queryData = {
    queries: [
      {
        queryKey: ['achievements', 42, 'schema_v2'],
        state: {
          data: {
            groups: [
              {
                achievements: [
                  { api_name: 'BOSS', description: 'Éliminer le "Polyèdre"', hidden: true },
                  { api_name: 'API', description: 'Description de la page', hidden: true },
                  { api_name: 'VIDE', description: '', hidden: true },
                ],
              },
            ],
          },
        },
      },
    ],
  };
  const page =
    '<script type="application/json" id="valve-ssr-data">' +
    JSON.stringify({ renderContext: { queryData: JSON.stringify(queryData) } }) +
    '</script>';

  it('lit le JSON de la page publique par identifiant de jeu et de succès', () => {
    expect(parseSteamPage(page, '42').get('BOSS')).toBe('Éliminer le "Polyèdre"');
    expect(parseSteamPage(page, '42').has('VIDE')).toBe(false);
    expect(parseSteamPage(page, '43').size).toBe(0);
    expect(parseSteamPage('<script id="valve-ssr-data">{</script>', '42').size).toBe(0);
  });

  it('garde le texte de l’API et complète seulement les succès cachés sans description', async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes('GetSchemaForGame')
        ? Response.json({
            game: {
              availableGameStats: {
                achievements: [
                  {
                    name: 'API',
                    displayName: 'API',
                    hidden: 1,
                    description: 'Description officielle',
                  },
                  { name: 'BOSS', displayName: 'Boss', hidden: 1 },
                  { name: 'VIDE', displayName: 'Vide', hidden: 0 },
                ],
              },
            },
          })
        : new Response(page),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect((await fetchSteamTexts('42', 'fr')).map((entry) => entry.description)).toEqual([
      'Description officielle',
      'Éliminer le "Polyèdre"',
      '',
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://steamcommunity.com/stats/42/achievements/',
      expect.objectContaining({ headers: { Cookie: 'Steam_Language=french' } }),
    );
  });
});

describe('rafraîchissement', () => {
  it('ne relit que les comptes qui n’ont pas été lus récemment', async () => {
    const result = await resolveIdentity(identity({ provider: 'STEAM' }), null);
    if (!result.ok) throw new Error('compte non créé');
    const { userId } = result;
    const run = await db.syncRun.create({
      data: { userId, provider: 'STEAM', status: 'COMPLETED' },
    });

    expect(await refreshAccounts(userId, 60_000)).toBe(0);
    await db.syncRun.update({
      where: { id: run.id },
      data: { startedAt: new Date(Date.now() - 120_000) },
    });
    const account = await db.linkedAccount.findFirstOrThrow({ where: { userId } });
    expect(account.syncStatus).toBe('IDLE');
    await db.linkedAccount.update({ where: { id: account.id }, data: { syncStatus: 'SYNCING' } });
    expect(await refreshAccounts(userId, 60_000)).toBe(0);
  });

  it('ne relit toute la bibliothèque Steam qu’au premier import ou après un échec', async () => {
    const send = vi.spyOn(PgBoss.prototype, 'send').mockResolvedValue('tâche');
    const sent = () => (send.mock.calls.at(-1)?.[1] ?? {}) as { light?: boolean };
    try {
      const userId = await steamUser();
      const where = { userId_provider: { userId, provider: 'STEAM' as const } };
      expect(await refreshAccounts(userId, 0)).toBe(1);
      expect(sent().light).toBeUndefined();

      await db.linkedAccount.update({
        where,
        data: { syncStatus: 'COMPLETED', lastSyncedAt: new Date() },
      });
      expect(await refreshAccounts(userId, 0)).toBe(1);
      expect(sent().light).toBe(true);

      await db.linkedAccount.update({ where, data: { syncStatus: 'FAILED' } });
      expect(await refreshAccounts(userId, 0)).toBe(1);
      expect(sent().light).toBeUndefined();
    } finally {
      send.mockRestore();
    }
  });

  it('le bouton Steam d’un compte importé passe par la tournée légère', async () => {
    const api = steamApi(ownedGames);
    vi.stubGlobal('fetch', api);
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM', quiet: true });
    api.mockClear();

    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => void events.push(event));
    try {
      await runSync({ userId, provider: 'STEAM', light: true });
    } finally {
      stop();
    }

    const urls = api.mock.calls.map(([input]) => String(input));
    // Ni la seconde liste des jeux gratuits, ni la relecture jeu par jeu.
    expect(urls.some((url) => url.includes('include_free_sub'))).toBe(false);
    expect(urls.some((url) => url.includes('GetPlayerAchievements'))).toBe(false);
    expect(urls.some((url) => url.includes('GetRecentlyPlayedGames'))).toBe(true);
    expect(events.at(-1)).toMatchObject({ status: 'COMPLETED', processed: 1, achievements: 0 });
    expect(
      await db.linkedAccount.findUniqueOrThrow({
        where: { userId_provider: { userId, provider: 'STEAM' } },
      }),
    ).toMatchObject({ syncStatus: 'COMPLETED' });
  });
});

describe('succès Steam reconnus sans identifiant', () => {
  async function catalog() {
    const game = await upsertGame({
      platform: 'STEAM',
      platformGameId: `${PREFIX}-${Math.random()}`,
      name: `${PREFIX} positions`,
    });
    const row = (id: string, name: string, icon: string, extra = {}) => ({
      gameId: game.id,
      platformAchievementId: id,
      name,
      iconUrl: `https://cdn/apps/1/${icon}.jpg`,
      ...extra,
    });
    await db.achievement.createMany({
      data: [
        row('UNIQUE', 'Seul', 'a'),
        // Même icône et même nom : seule la description les distingue.
        row('NORMAL', 'Chapitre 1', 'c', { description: 'En normal' }),
        row('DIFFICILE', 'Chapitre 1', 'c', { description: 'En difficile' }),
        row('CACHE', 'Secret', 's', { hidden: true }),
        row('JUMEAU_1', 'Pareil', 'p'),
        row('JUMEAU_2', 'Pareil', 'p'),
      ],
    });
    return game.id;
  }

  it('relie chaque entrée sûre, retient sa position et complète les descriptions cachées', async () => {
    const gameId = await catalog();
    const matched = await matchTopAchievements(gameId, [
      { statid: 1, bit: 0, name: 'Seul', icon: 'a.jpg' },
      { statid: 1, bit: 1, name: 'Chapitre 1', desc: 'En difficile', icon: 'c.jpg' },
      { statid: 1, bit: 2, name: 'Secret', desc: 'Trouver la salle', icon: 's.jpg', hidden: true },
      // Indiscernables : laissés à GetPlayerAchievements.
      { statid: 1, bit: 3, name: 'Pareil', icon: 'p.jpg' },
    ]);
    expect([...matched.values()].sort()).toEqual(['CACHE', 'DIFFICILE', 'UNIQUE']);

    const rows = await db.achievement.findMany({
      where: { gameId },
      select: { platformAchievementId: true, steamStatBit: true, description: true },
    });
    const by = new Map(rows.map((row) => [row.platformAchievementId, row]));
    expect(by.get('DIFFICILE')?.steamStatBit).toBe(33);
    expect(by.get('JUMEAU_1')?.steamStatBit).toBeNull();
    expect(by.get('CACHE')?.description).toBe('Trouver la salle');

    // La position apprise suffit ensuite, même si le nom et l'icône ont changé.
    const again = await matchTopAchievements(gameId, [
      { statid: 1, bit: 1, name: 'Autre', icon: 'z.jpg' },
    ]);
    expect([...again.values()]).toEqual(['DIFFICILE']);
  });

  it('remplace une date provisoire par une date plus ancienne, jamais l’inverse', async () => {
    const gameId = await catalog();
    const user = await resolveIdentity(identity({ provider: 'STEAM' }), null);
    if (!user.ok) throw new Error('compte non créé');
    const later = new Date('2026-11-14T12:00:00Z');
    const exact = new Date('2026-11-14T11:59:50Z');
    const first = await saveProgress(user.userId, gameId, [
      { platformAchievementId: 'UNIQUE', unlockedAt: later },
    ]);
    expect(first.gained).toBe(1);
    const corrected = await saveProgress(user.userId, gameId, [
      { platformAchievementId: 'UNIQUE', unlockedAt: exact },
    ]);
    // Une date corrigée n'est pas un nouveau succès.
    expect(corrected.gained).toBe(0);
    await saveProgress(user.userId, gameId, [
      { platformAchievementId: 'UNIQUE', unlockedAt: later },
    ]);
    const row = await db.userAchievement.findFirstOrThrow({ where: { userId: user.userId } });
    expect(row.unlockedAt.toISOString()).toBe(exact.toISOString());
  });
});
