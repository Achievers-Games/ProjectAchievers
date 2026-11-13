// Tests sur un vrai PostgreSQL : `npm run dev:db` ou le service de la CI.
import 'dotenv/config';
import { describe, expect, it, vi } from 'vitest';
import { listGames } from './queries';
import { resolveIdentity } from './accounts';
import { type CardDrop } from '#lib/collection';
import { db } from './db';
import { globals } from './globals';
import { checkLiveGames } from './sync/live';
import { enqueueSync, refreshAccounts, runSync, startWorkers } from './sync/queue';
import { isAdultOnly, rateGames, tagGames } from './sync/content';
import { onCard, onSync, type SyncEvent } from './sync/events';
import { parseSteamPage, requestStoreSweep, steamImages, sweepSteamStore } from './sync/steam';
import { saveAchievements, saveProgress, upsertGame } from './sync/store';
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

  it('relit les jeux récents même si GetOwnedGames ne donne pas playtime_2weeks', async () => {
    const { userId, state } = await delayedAchievement();
    state.recent = true;
    await runSync({ userId, provider: 'STEAM', quiet: true });
    expect(state.reads).toBe(1);
    expect(await db.userGame.findFirst({ where: { userId } })).toMatchObject({ unlockedCount: 2 });
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
    expect(await saveProgress(userId, game.id, unlocks)).toEqual({ gained: 0, fresh: [] });
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

  /** Un ami possède le jeu 999003 ; le joueur y a des succès sans l'avoir en bibliothèque. */
  function sharedGameApi(calls: string[] = []) {
    const api = steamApi(ownedGames);
    const body = (value: unknown) => new Response(JSON.stringify(value));
    const friend = '76561190000000002';
    const borrowed = { appid: 999003, name: `${PREFIX} emprunté` };
    return vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('GetFriendList')) {
        return body({ friendslist: { friends: [{ steamid: friend }] } });
      }
      if (url.includes('GetOwnedGames') && url.includes(friend)) {
        return body({ response: { games: [borrowed] } });
      }
      if (url.includes('GetTopAchievementsForGames')) {
        const asked = url.includes('999003');
        return body({
          response: {
            games: asked ? [{ appid: 999003, achievements: [{ name: 'Alpha' }] }] : [],
          },
        });
      }
      if (url.includes('GetAppList')) {
        return body({ response: { apps: [{ appid: 999003, name: borrowed.name }] } });
      }
      return api(input);
    });
  }

  it('retrouve un jeu partagé en famille grâce à la bibliothèque d’un ami', async () => {
    vi.stubGlobal('fetch', sharedGameApi());
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });

    const row = await db.userGame.findFirstOrThrow({
      where: { userId, game: { platformGameId: '999003' } },
    });
    expect(row).toMatchObject({ unlockedCount: 1, completion: 50, lastPlayedAt: null });
  });

  it('ne cherche les jeux partagés chez les amis qu’une fois par jour', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', sharedGameApi(calls));
    const userId = await steamUser();

    await runSync({ userId, provider: 'STEAM' });
    calls.length = 0;
    await runSync({ userId, provider: 'STEAM' });

    expect(calls.some((url) => url.includes('GetFriendList'))).toBe(false);
  });

  it('garde la synchronisation si la recherche des jeux partagés échoue', async () => {
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
    expect(account.sharedCheckedAt).toBeNull();
  });

  it('balaye la boutique pour un compte, puis le laisse tranquille', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', sharedGameApi(calls));
    await db.linkedAccount.updateMany({
      where: { provider: 'STEAM' },
      data: { storeSweptAt: new Date() },
    });
    const userId = await steamUser();

    expect(await sweepSteamStore()).toBe(1);
    expect(await db.userGame.count({ where: { userId } })).toBe(1);

    calls.length = 0;
    expect(await sweepSteamStore()).toBe(0);
    expect(calls).toEqual([]);
  });

  it('avance le balayage à la demande du joueur, au plus une fois par semaine', async () => {
    const userId = await steamUser();
    const sweptAt = async () =>
      (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).storeSweptAt;
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await db.linkedAccount.updateMany({ where: { userId }, data: { storeSweptAt: recent } });

    await requestStoreSweep(userId);
    expect(await sweptAt()).toEqual(recent);

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.linkedAccount.updateMany({ where: { userId }, data: { storeSweptAt: old } });
    await requestStoreSweep(userId);
    expect(await sweptAt()).toBeNull();
  });

  it('traite le catalogue Steam page par page avant de demander la suite', async () => {
    await db.linkedAccount.updateMany({
      where: { provider: 'STEAM' },
      data: { storeSweptAt: new Date() },
    });
    const userId = await steamUser();
    const events: string[] = [];
    const api = sharedGameApi();
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.includes('GetAppList')) {
        expect(url.searchParams.get('max_results')).toBe('1000');
        const next = url.searchParams.get('last_appid') !== '0';
        events.push(next ? 'page-2' : 'page-1');
        return new Response(
          JSON.stringify({
            response: {
              apps: [{ appid: next ? 999004 : 999003, name: `${PREFIX} page` }],
              have_more_results: !next,
              last_appid: next ? 999004 : 999003,
            },
          }),
        );
      }
      if (url.pathname.includes('GetTopAchievementsForGames')) {
        const id = url.searchParams.get('appids[0]');
        events.push(`lecture-${id}`);
        return new Response(
          JSON.stringify({ response: { games: [{ appid: Number(id), achievements: [{}] }] } }),
        );
      }
      return api(input);
    });
    expect(await sweepSteamStore()).toBe(2);
    expect(events).toEqual(['page-1', 'lecture-999003', 'page-2', 'lecture-999004']);
    expect(await db.userGame.count({ where: { userId } })).toBe(2);
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
    await runSync({ userId, provider: 'STEAM' });
    steamid = (await db.linkedAccount.findFirstOrThrow({ where: { userId } })).providerUserId;
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    unlocked.push({ apiname: 'B', achieved: 1, unlocktime: 1_700_000_100 });
    await checkLiveGames();
    await checkLiveGames();
    stop();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ status: 'COMPLETED', achievements: 1, quiet: true });
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
      return url.includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

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
      return url.includes('GetPlayerAchievements')
        ? new Response(JSON.stringify({ playerstats: { achievements: unlocked } }))
        : api(input);
    });
    const userId = await steamUser();
    await runSync({ userId, provider: 'STEAM' });
    const events: SyncEvent[] = [];
    const stop = onSync(userId, (event) => events.push(event));

    await db.userGame.updateMany({
      where: { userId },
      data: { achievementsCheckedAt: new Date(Date.now() - 4 * 60_000) },
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
        },
        { appid: Number(cuteId), tags: [{ tagid: 4726, weight: 300 }] },
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
  it('lit leur description dans la page du joueur', () => {
    const page = String.raw`{\"api_name\":\"BOSS\",\"name\":\"On répète\",\"description\":\"Éliminer le \\\"Polyèdre\\\"\",\"hidden\":true,\"icon\":\"a.jpg\"},{\"api_name\":\"VIDE\",\"name\":\"Rien\",\"description\":\"\",\"hidden\":true}`;
    const descriptions = parseSteamPage(page);
    expect(descriptions.get('BOSS')).toBe('Éliminer le "Polyèdre"');
    expect(descriptions.has('VIDE')).toBe(false);
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
});
