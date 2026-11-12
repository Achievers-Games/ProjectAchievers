import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import { applyAccountLook, identityLook } from '../accounts';
import { db } from '../db';
import { env } from '../env';
import { backgroundWork } from '../workload';
import { logger } from '#lib/logger';
import { fetchSteamIdentity } from '../providers/steam';

const log = logger('Steam');
import { fetchRetry, mapLimit, sleep, SyncError, syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync, SyncContext } from './types';

const API = 'https://api.steampowered.com';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const STORE = 'https://store.steampowered.com/api/appdetails';
const SCHEMA_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const ACHIEVEMENT_RECHECK = 24 * 60 * 60 * 1000;
const concurrency = () => env().STEAM_CONCURRENCY;
/** Steam refuse 400 jeux d'un coup. */
const APPS_PER_CALL = 300;
const SHARED_CHECK_EVERY = 24 * 60 * 60 * 1000;
const STORE_SWEEP_EVERY = 30 * 24 * 60 * 60 * 1000;
/** Toute la boutique coûte des centaines d'appels : le joueur ne peut pas la relancer à volonté. */
const STORE_SWEEP_FORCED_EVERY = 7 * 24 * 60 * 60 * 1000;
/** Un balayage qui échoue (profil privé, panne de Steam) est retenté le lendemain. */
const STORE_SWEEP_RETRY = 24 * 60 * 60 * 1000;
const MAX_FRIENDS = 300;

interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
  has_community_visible_stats?: boolean;
}

interface SchemaAchievement {
  name: string;
  displayName: string;
  description?: string;
  hidden: number;
  icon: string;
  icongray: string;
}

/**
 * Le jeu n'a pas bougé depuis la dernière synchronisation : ni nouveau lancement, ni temps de jeu
 * en plus. `GetOwnedGames` n'envoie plus `rtime_last_played` : deux dates absentes ne disaient donc
 * rien, et le jeu était sauté à chaque passage — plus aucun succès Steam n'arrivait.
 *
 * Le temps de jeu seul ne suffit pas non plus : Steam publie les succès avec retard, et la relecture
 * en direct enregistre parfois le temps de jeu avant que le succès soit visible. Un jeu joué ces
 * deux dernières semaines est donc toujours relu.
 */
export const unchangedSince = (
  known: { lastPlayedAt: Date | null; playtimeMinutes: number },
  playedAt: Date | null,
  minutes: number,
  recentMinutes = 0,
) =>
  recentMinutes === 0 &&
  (known.lastPlayedAt?.getTime() ?? null) === (playedAt?.getTime() ?? null) &&
  known.playtimeMinutes === minutes;

async function steamGet(path: string, params: Record<string, string | number>) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('key', env().STEAM_API_KEY ?? '');
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return fetchRetry(url);
}

async function fetchOwnedGames(steamId: string): Promise<OwnedGame[]> {
  const response = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
    // Par défaut, Steam retire de la liste les jeux qu'il n'a pas validés.
    skip_unvetted_apps: 0,
  });
  if (!response.ok) throw new Error(`GetOwnedGames a répondu ${response.status}`);
  const data = (await response.json()) as {
    response?: { games?: OwnedGame[]; game_count?: number };
  };
  // Steam répond 200 avec un objet vide quand les détails de jeu sont privés. Une bibliothèque
  // publique mais vide donne `game_count: 0` sans `games` : ce n'est pas un profil privé.
  if (data.response?.games) return data.response.games;
  if (typeof data.response?.game_count === 'number') return [];
  throw new SyncError('sync_steam_private');
}

export async function fetchRecentGames(steamId: string): Promise<OwnedGame[]> {
  const response = await steamGet('/IPlayerService/GetRecentlyPlayedGames/v1/', {
    steamid: steamId,
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { response?: { games?: OwnedGame[] } };
  return data.response?.games ?? [];
}

/** Les membres d'une famille Steam sont le plus souvent amis, et leur bibliothèque peut être lue. */
async function fetchFriendGames(steamId: string) {
  const response = await steamGet('/ISteamUser/GetFriendList/v1/', {
    steamid: steamId,
    relationship: 'friend',
  });
  // 401 : la liste d'amis est privée.
  if (!response.ok) return [];
  const data = (await response.json()) as {
    friendslist?: { friends?: { steamid: string }[] };
  };
  const friends = (data.friendslist?.friends ?? []).slice(0, MAX_FRIENDS);
  const games = new Map<number, OwnedGame>();
  await mapLimit(friends, concurrency(), async ({ steamid }) => {
    // Seuls l'identifiant et le nom valent pour le joueur : le temps de jeu est celui de l'ami.
    for (const { appid, name } of await fetchOwnedGames(steamid).catch(() => [])) {
      games.set(appid, { appid, name });
    }
  });
  return [...games.values()];
}

async function* fetchStorePages() {
  let lastApp = 0;
  for (;;) {
    const response = await steamGet('/IStoreService/GetAppList/v1/', {
      include_games: 'true',
      include_dlc: 'false',
      max_results: 1_000,
      last_appid: lastApp,
    });
    if (!response.ok) throw new Error(`GetAppList a répondu ${response.status}`);
    const { response: page } = (await response.json()) as {
      response?: { apps?: OwnedGame[]; have_more_results?: boolean; last_appid?: number };
    };
    yield page?.apps ?? [];
    if (!page?.have_more_results) return;
    if (!page.last_appid || page.last_appid <= lastApp)
      throw new Error('Pagination Steam sans progression');
    lastApp = page.last_appid;
  }
}

/**
 * Steam ne dit pas quels jeux un joueur emprunte, mais cette méthode, non documentée, répond
 * pour n'importe quel jeu et ne renvoie vide que si le joueur n'y a aucun succès.
 */
async function appsWithUnlocks(steamId: string, appIds: number[], limit = concurrency()) {
  const batches = Array.from({ length: Math.ceil(appIds.length / APPS_PER_CALL) }, (_, index) =>
    appIds.slice(index * APPS_PER_CALL, (index + 1) * APPS_PER_CALL),
  );
  const found = new Set<number>();
  await mapLimit(batches, limit, async (batch) => {
    const params: Record<string, string | number> = { steamid: steamId, max_achievements: 1 };
    batch.forEach((appId, index) => (params[`appids[${index}]`] = appId));
    const response = await steamGet('/IPlayerService/GetTopAchievementsForGames/v1/', params);
    if (!response.ok) throw new Error(`GetTopAchievementsForGames a répondu ${response.status}`);
    const data = (await response.json()) as {
      response?: { games?: { appid: number; achievements?: unknown[] }[] };
    };
    for (const game of data.response?.games ?? []) {
      if (game.achievements?.length) found.add(game.appid);
    }
  });
  return found;
}

/**
 * Les jeux empruntés n'apparaissent pas dans la bibliothèque du joueur. La synchronisation part
 * toutes les quelques minutes : seuls les jeux récents sont cherchés à chaque fois.
 */
async function findSharedGames(
  { userId, account }: Pick<SyncContext, 'userId' | 'account'>,
  owned: Set<number>,
  recent: OwnedGame[],
) {
  const steamId = account.providerUserId;
  const candidates = new Map<number, OwnedGame>();

  const daily =
    !account.sharedCheckedAt ||
    Date.now() - account.sharedCheckedAt.getTime() >= SHARED_CHECK_EVERY;
  if (daily) {
    const [friends, catalog, known] = await Promise.all([
      fetchFriendGames(steamId),
      db.game.findMany({
        where: { platform: 'STEAM', totalAchievements: { gt: 0 } },
        select: { platformGameId: true, name: true },
      }),
      db.userGame.findMany({
        where: { userId, game: { platform: 'STEAM' } },
        select: { game: { select: { platformGameId: true, name: true } } },
      }),
    ]);
    const stored = [...catalog, ...known.map(({ game }) => game)];
    for (const game of friends) candidates.set(game.appid, game);
    for (const { platformGameId, name } of stored) {
      candidates.set(Number(platformGameId), { appid: Number(platformGameId), name });
    }
  }
  for (const game of recent) candidates.set(game.appid, game);
  for (const appId of owned) candidates.delete(appId);

  const played = await appsWithUnlocks(steamId, [...candidates.keys()]);
  if (daily) {
    await db.linkedAccount.update({
      where: { id: account.id },
      data: { sharedCheckedAt: new Date() },
    });
  }
  return [...played].flatMap((appId) => candidates.get(appId) ?? []);
}

/**
 * Les jeux récents n'ont plus d'image à l'adresse classique : seule la boutique
 * connaît leur adresse, qui contient une empreinte propre à chaque jeu.
 */
export async function steamImages(appId: string | number) {
  const classic = {
    coverUrl: `${CDN}/${appId}/library_600x900.jpg`,
    headerUrl: `${CDN}/${appId}/header.jpg`,
  };
  try {
    const signal = AbortSignal.timeout(10_000);
    const head = await fetch(classic.headerUrl, { method: 'HEAD', signal });
    if (head.status !== 404) return classic;

    const response = await fetchRetry(`${STORE}?appids=${appId}&filters=basic`);
    const data = (await response.json()) as Record<
      string,
      { data?: { header_image?: string } } | undefined
    >;
    const image = data[appId]?.data?.header_image;
    return image ? { coverUrl: image, headerUrl: image } : classic;
  } catch {
    return classic;
  }
}

/** L'API indique encore un ancien serveur, qui n'a pas les icônes des jeux récents. */
const steamIcon = (url: string) =>
  url.replace(
    'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/',
    'https://shared.fastly.steamstatic.com/community_assets/images/apps/',
  );

export const mapSchema = (
  achievements: SchemaAchievement[],
  rarity: Map<string, number>,
): AchievementInput[] =>
  achievements.map((a) => ({
    platformAchievementId: a.name,
    name: a.displayName || a.name,
    description: a.description ?? '',
    iconUrl: steamIcon(a.icon),
    iconLockedUrl: steamIcon(a.icongray),
    hidden: a.hidden === 1,
    trophyType: 'ACHIEVEMENT',
    globalRarity: rarity.get(a.name) ?? null,
  }));

/** `null` si Steam n'a pas répondu ; une liste vide si le jeu n'a pas de succès. */
async function fetchSchemaAchievements(appId: string | number, language: string) {
  const response = await steamGet('/ISteamUserStats/GetSchemaForGame/v2/', {
    appid: appId,
    l: language,
  });
  if (!response.ok) return null;
  const schema = (await response.json()) as {
    game?: { availableGameStats?: { achievements?: SchemaAchievement[] } };
  };
  return schema.game?.availableGameStats?.achievements ?? [];
}

async function fetchSchema(appId: number): Promise<AchievementInput[] | null> {
  const achievements = await fetchSchemaAchievements(appId, 'french');
  if (!achievements?.length) return achievements && [];

  const rarityResponse = await steamGet(
    '/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/',
    { gameid: appId },
  );
  const rarity = new Map<string, number>();
  if (rarityResponse.ok) {
    const data = (await rarityResponse.json()) as {
      achievementpercentages?: { achievements?: { name: string; percent: number | string }[] };
    };
    for (const a of data.achievementpercentages?.achievements ?? []) {
      rarity.set(a.name, Number(a.percent));
    }
  }
  return mapSchema(achievements, rarity);
}

const STEAM_LANGUAGES: Record<Locale, string> = {
  fr: 'french',
  en: 'english',
  es: 'spanish',
  de: 'german',
  'pt-BR': 'brazilian',
  ru: 'russian',
  'zh-CN': 'schinese',
  ja: 'japanese',
};

export async function fetchSteamTexts(appId: string, locale: Locale) {
  const achievements = await fetchSchemaAchievements(appId, STEAM_LANGUAGES[locale]);
  if (!achievements) throw new Error('GetSchemaForGame sans réponse');
  const owner = await db.linkedAccount.findFirst({
    where: {
      provider: 'STEAM',
      user: { games: { some: { game: { platform: 'STEAM', platformGameId: appId } } } },
    },
    select: { providerUserId: true },
  });
  // Les textes de l'API suffisent : la page publique ne fait que compléter les succès cachés.
  const hidden = owner
    ? await fetchPageDescriptions(owner.providerUserId, appId, locale).catch(() => null)
    : null;

  return achievements.map((a) => ({
    platformAchievementId: a.name,
    name: a.displayName || a.name,
    description: a.description || hidden?.get(a.name) || '',
  }));
}

const unescape = (text: string) => {
  try {
    return JSON.parse(`"${text}"`) as string;
  } catch {
    return text;
  }
};

/** Lit dans la page d'un joueur les données du site Steam, seules à décrire les succès cachés. */
export function parseSteamPage(html: string) {
  const entries =
    /\\"api_name\\":\\"(.*?)\\",\\"name\\":\\".*?\\",\\"description\\":\\"(.*?)\\",\\"hidden\\":/g;
  const descriptions = new Map<string, string>();
  for (const [, apiName, description] of html.matchAll(entries)) {
    if (apiName && description) descriptions.set(apiName, unescape(unescape(description)));
  }
  return descriptions;
}

async function fetchPageDescriptions(steamId: string, appId: string, locale: Locale) {
  const response = await fetchRetry(
    `https://steamcommunity.com/profiles/${steamId}/stats/${appId}/achievements/`,
    { headers: { Cookie: `Steam_Language=${STEAM_LANGUAGES[locale]}` } },
  );
  return response.ok ? parseSteamPage(await response.text()) : new Map<string, string>();
}

const HIDDEN_BATCH = 60;
const HIDDEN_PAUSE = 2_000;

/** L'API ne décrit pas les succès cachés : la page d'un joueur qui a le jeu comble ces trous. */
export async function fillHiddenDescriptions(limit = HIDDEN_BATCH, pause = HIDDEN_PAUSE) {
  const games = await db.$queryRaw<{ id: string; appId: string; steamId: string }[]>`
    SELECT id, "appId", "steamId"
    FROM (
      SELECT DISTINCT ON (g.id) g.id, g."platformGameId" AS "appId", la."providerUserId" AS "steamId"
      FROM "Game" g
      JOIN "Achievement" a ON a."gameId" = g.id AND a.hidden AND a.description = ''
      JOIN "UserGame" ug ON ug."gameId" = g.id
      JOIN "LinkedAccount" la ON la."userId" = ug."userId" AND la.provider = 'STEAM'
      WHERE g.platform = 'STEAM'
    ) missing
    ORDER BY random()
    LIMIT ${limit}`;

  let filled = 0;
  for (const game of games) {
    const descriptions = await fetchPageDescriptions(game.steamId, game.appId, baseLocale);
    await db.$transaction(
      [...descriptions].map(([platformAchievementId, description]) =>
        db.achievement.updateMany({
          where: { gameId: game.id, platformAchievementId, description: '' },
          data: { description },
        }),
      ),
    );
    filled += descriptions.size ? 1 : 0;
    await sleep(pause);
  }
  return filled;
}

export async function fetchUnlocks(steamId: string, appId: number) {
  const response = await steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', {
    steamid: steamId,
    appid: appId,
  });
  // 400 : le jeu n'a pas de statistiques. Ce n'est pas une erreur du joueur.
  if (response.status === 400) return [];
  if (response.status === 403) {
    throw new SyncError('sync_steam_achievements_private');
  }
  if (!response.ok) throw new Error(`GetPlayerAchievements a répondu ${response.status}`);

  const data = (await response.json()) as {
    playerstats?: { achievements?: { apiname: string; achieved: number; unlocktime: number }[] };
  };
  return (data.playerstats?.achievements ?? [])
    .filter((a) => a.achieved === 1)
    .map((a) => ({
      platformAchievementId: a.apiname,
      unlockedAt: new Date(a.unlocktime * 1000),
    }));
}

/** Lit un jeu et les succès du joueur. Sans réponse pour un jeu emprunté, le jeu est laissé. */
async function syncSteamGame(userId: string, steamId: string, source: OwnedGame, shared: boolean) {
  const appId = String(source.appid);
  const game = await upsertGame({
    platform: 'STEAM',
    platformGameId: appId,
    name: source.name,
    ...(await steamImages(appId)),
  });

  const stale = !game.schemaSyncedAt || Date.now() - game.schemaSyncedAt.getTime() > SCHEMA_MAX_AGE;
  if (stale) {
    const schema = await fetchSchema(source.appid);
    if (schema) await saveAchievements(game.id, schema);
  }

  const unlocks = await fetchUnlocks(steamId, source.appid).catch((error: unknown) => {
    if (shared && error instanceof SyncError) return null;
    throw error;
  });
  if (!unlocks) return { game, gained: 0 };

  const { gained } = await saveProgress(
    userId,
    game.id,
    unlocks,
    // La bibliothèque d'un autre ne dit rien du temps passé par ce joueur.
    {
      achievementsCheckedAt: new Date(),
      ...(shared
        ? { playtimeMinutes: source.playtime_forever }
        : {
            playtimeMinutes: source.playtime_forever ?? 0,
            lastPlayedAt: source.rtime_last_played
              ? new Date(source.rtime_last_played * 1000)
              : null,
          }),
    },
  );
  return { game, gained };
}

/** Une resynchronisation demandée par le joueur avance son prochain balayage. */
export async function requestStoreSweep(userId: string) {
  await db.linkedAccount.updateMany({
    where: {
      userId,
      provider: 'STEAM',
      storeSweptAt: { lt: new Date(Date.now() - STORE_SWEEP_FORCED_EVERY) },
    },
    data: { storeSweptAt: null },
  });
}

/** Rattrape les jeux qu'aucune recherche rapide ne voit, un compte à la fois. */
export async function sweepSteamStore() {
  const account = await db.linkedAccount.findFirst({
    where: {
      provider: 'STEAM',
      syncStatus: { notIn: ['QUEUED', 'SYNCING'] },
      OR: [
        { storeSweptAt: null },
        { storeSweptAt: { lt: new Date(Date.now() - STORE_SWEEP_EVERY) } },
      ],
    },
    orderBy: { storeSweptAt: { sort: 'asc', nulls: 'first' } },
  });
  if (!account) return 0;

  const steamId = account.providerUserId;
  const owned = await backgroundWork(
    'Steam : bibliothèque du balayage',
    () => fetchOwnedGames(steamId).catch(() => null),
    -1,
  );
  // Ne jamais marquer un balayage comme terminé si la bibliothèque est inaccessible : il est
  // seulement repoussé, sinon ce compte repasserait en tête à chaque heure et bloquerait les autres.
  if (!owned) {
    await postponeSweep(account.id);
    return 0;
  }
  try {
    return await sweepStoreFor(account, owned);
  } catch (cause) {
    await postponeSweep(account.id);
    throw cause;
  }
}

/** Remet le balayage d'un compte au lendemain, derrière ceux qui attendent encore. */
const postponeSweep = (accountId: string) =>
  db.linkedAccount.update({
    where: { id: accountId },
    data: { storeSweptAt: new Date(Date.now() - STORE_SWEEP_EVERY + STORE_SWEEP_RETRY) },
  });

async function sweepStoreFor(
  account: { id: string; userId: string; providerUserId: string },
  owned: OwnedGame[],
) {
  const steamId = account.providerUserId;
  const skipped = new Set(owned.map((game) => game.appid));
  let found = 0;
  // Chaque page libère le budget de fond : un import en attente passe avant la page suivante.
  const pages = fetchStorePages();
  for (;;) {
    const page = await backgroundWork('Steam : page du catalogue', () => pages.next(), -1);
    if (page.done) break;
    const candidates = page.value.filter((app) => !skipped.has(app.appid));
    if (!candidates.length) continue;
    for (let offset = 0; offset < candidates.length; offset += APPS_PER_CALL) {
      const batch = candidates.slice(offset, offset + APPS_PER_CALL);
      const playedGames = await backgroundWork(
        'Steam : recherche des jeux empruntés',
        async () => {
          const known = await db.userGame.findMany({
            where: {
              userId: account.userId,
              game: {
                platform: 'STEAM',
                platformGameId: { in: batch.map((game) => String(game.appid)) },
              },
            },
            select: { game: { select: { platformGameId: true } } },
          });
          const have = new Set(known.map(({ game }) => Number(game.platformGameId)));
          const missing = batch.filter((game) => !have.has(game.appid));
          const played = await appsWithUnlocks(
            steamId,
            missing.map((game) => game.appid),
            1,
          );
          return missing.filter((game) => played.has(game.appid));
        },
        -1,
      );
      for (const game of playedGames) {
        await backgroundWork(
          'Steam : import d’un jeu emprunté',
          () => syncSteamGame(account.userId, steamId, game, true),
          -1,
        );
        found++;
      }
    }
  }
  await db.linkedAccount.update({
    where: { id: account.id },
    data: { storeSweptAt: new Date() },
  });
  return found;
}

export const syncSteam: ProviderSync = async ({
  userId,
  account,
  report,
  onUnlocked,
  force = false,
}) => {
  const steamId = account.providerUserId;
  const owned = (await fetchOwnedGames(steamId)).filter((g) => g.has_community_visible_stats);
  const library = new Set(owned.map((game) => game.appid));
  const recentGames = await fetchRecentGames(steamId).catch(() => []);
  const recentlyPlayed = new Set(recentGames.map((game) => String(game.appid)));
  // Une méthode non documentée peut disparaître : la bibliothèque reste synchronisée.
  const shared = await findSharedGames({ userId, account }, library, recentGames).catch((cause) => {
    log.error('Jeux partagés Steam :', cause);
    return [];
  });

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'STEAM' } },
    select: {
      lastPlayedAt: true,
      playtimeMinutes: true,
      achievementsCheckedAt: true,
      game: { select: { platformGameId: true } },
    },
  });
  const knownProgress = new Map(previous.map((row) => [row.game.platformGameId, row]));

  let achievements = 0;

  const games = await syncGames(
    [...owned, ...shared],
    { platform: 'Steam', concurrency: concurrency(), name: (g) => g.name, report },
    async (ownedGame) => {
      const appId = String(ownedGame.appid);
      const borrowed = !library.has(ownedGame.appid);
      const playedAt = ownedGame.rtime_last_played
        ? new Date(ownedGame.rtime_last_played * 1000)
        : null;
      const minutes = ownedGame.playtime_forever ?? 0;

      // Le temps de jeu ne prouve pas l'absence de nouveaux succès (publication tardive,
      // déblocage rétroactif). Au moins une vraie lecture par jour, ou sur demande explicite.
      const known = knownProgress.get(appId);
      const recent = recentlyPlayed.has(appId) ? 1 : (ownedGame.playtime_2weeks ?? 0);
      const checkedAt = known?.achievementsCheckedAt?.getTime();
      const checkedRecently =
        checkedAt !== undefined && Date.now() - checkedAt < ACHIEVEMENT_RECHECK;
      if (
        !force &&
        !borrowed &&
        known &&
        checkedRecently &&
        unchangedSince(known, playedAt, minutes, recent)
      )
        return;

      const { game, gained } = await syncSteamGame(userId, steamId, ownedGame, borrowed);
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  // Le joueur a pu changer d'avatar ou de cadre sur Steam depuis sa dernière connexion.
  const identity = await fetchSteamIdentity(steamId).catch(() => null);
  if (identity)
    await applyAccountLook(account, identityLook(identity, account), identity.avatarUrl);

  return { games, achievements };
};
