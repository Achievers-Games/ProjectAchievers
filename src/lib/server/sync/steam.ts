import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import { applyAccountLook, identityLook } from '../accounts';
import { db } from '../db';
import { env } from '../env';
import { logger } from '#lib/logger';
import { fetchPlayingGames, fetchSteamIdentity } from '../providers/steam';

const log = logger('Steam');
import { fetchRetry, mapLimit, sleep, SyncError, syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync } from './types';

const API = 'https://api.steampowered.com';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const STORE = 'https://store.steampowered.com/api/appdetails';
const SCHEMA_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const ACHIEVEMENT_RECHECK = 24 * 60 * 60 * 1000;
const concurrency = () => env().STEAM_CONCURRENCY;
/** Steam refuse 400 jeux d'un coup. */
const APPS_PER_CALL = 300;

export interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
  has_community_visible_stats?: boolean;
  /** Prêté par un membre de la famille Steam : le temps de jeu reste celui du joueur. */
  family_shared?: boolean;
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
 * Cette règle n'est plus qu'un recours : la synchronisation compare d'abord le nombre de succès
 * que Steam annonce par jeu (`achievementCounts`), ce qui voit aussi un succès publié en retard.
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

const LIBRARY = {
  include_appinfo: 1,
  include_played_free_games: 1,
  // Par défaut, Steam retire de la liste les jeux qu'il n'a pas validés.
  skip_unvetted_apps: 0,
  // Les jeux d'une famille Steam, avec le temps de jeu du joueur lui-même : sans ce paramètre,
  // ils n'étaient retrouvés qu'en lisant la bibliothèque de chaque ami, et sans leur temps.
  include_family_licenses: 1,
};

async function ownedGames(steamId: string, extra: Record<string, number> = {}) {
  const response = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId,
    ...LIBRARY,
    ...extra,
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

/**
 * La bibliothèque du joueur. Les jeux gratuits forment une seconde liste, bien plus longue : n'en
 * sont gardés que ceux qu'il a réellement lancés, pour ne pas remplir son profil de jeux jamais vus.
 */
async function fetchOwnedGames(steamId: string): Promise<OwnedGame[]> {
  const games = await ownedGames(steamId);
  const free = await ownedGames(steamId, { include_free_sub: 1, include_all_free_games: 1 }).catch(
    () => [],
  );
  const listed = new Set(games.map((game) => game.appid));
  return [
    ...games,
    ...free.filter((game) => !listed.has(game.appid) && (game.playtime_forever ?? 0) > 0),
  ];
}

export async function fetchRecentGames(steamId: string): Promise<OwnedGame[]> {
  const response = await steamGet('/IPlayerService/GetRecentlyPlayedGames/v1/', {
    steamid: steamId,
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { response?: { games?: OwnedGame[] } };
  return data.response?.games ?? [];
}

/** Au-delà d'aucun jeu connu : la réponse porte alors tous les succès obtenus, donc leur nombre. */
const ALL_ACHIEVEMENTS = 10_000;

/**
 * Par jeu, le nombre de succès que le joueur a obtenus et le total du jeu, pour 300 jeux par
 * appel. C'est ce qui dit, sans lire chaque jeu, lesquels ont bougé : une bibliothèque de 700
 * jeux se vérifie en trois appels au lieu de 700. Avec `max` à 1, la réponse reste légère et
 * dit seulement si le joueur a quelque chose sur le jeu.
 */
async function achievementCounts(
  steamId: string,
  appIds: number[],
  max = ALL_ACHIEVEMENTS,
  limit = concurrency(),
) {
  const batches = Array.from({ length: Math.ceil(appIds.length / APPS_PER_CALL) }, (_, index) =>
    appIds.slice(index * APPS_PER_CALL, (index + 1) * APPS_PER_CALL),
  );
  const counts = new Map<number, { unlocked: number; total: number }>();
  await mapLimit(batches, limit, async (batch) => {
    const params: Record<string, string | number> = { steamid: steamId, max_achievements: max };
    batch.forEach((appId, index) => (params[`appids[${index}]`] = appId));
    const response = await steamGet('/IPlayerService/GetTopAchievementsForGames/v1/', params);
    if (!response.ok) throw new Error(`GetTopAchievementsForGames a répondu ${response.status}`);
    const data = (await response.json()) as {
      response?: {
        games?: { appid: number; total_achievements?: number; achievements?: unknown[] }[];
      };
    };
    for (const game of data.response?.games ?? []) {
      counts.set(game.appid, {
        unlocked: game.achievements?.length ?? 0,
        total: game.total_achievements ?? 0,
      });
    }
  });
  return counts;
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
async function syncSteamGame(
  userId: string,
  steamId: string,
  source: OwnedGame,
  shared: boolean,
  refreshSchema = false,
) {
  const appId = String(source.appid);
  // Les images ne se cherchent qu'une fois : sinon chaque relecture coûtait un appel par jeu.
  const known = await db.game.findUnique({
    where: { platform_platformGameId: { platform: 'STEAM', platformGameId: appId } },
    select: { headerUrl: true },
  });
  const game = await upsertGame({
    platform: 'STEAM',
    platformGameId: appId,
    name: source.name,
    ...(known?.headerUrl ? {} : await steamImages(appId)),
  });

  const stale = !game.schemaSyncedAt || Date.now() - game.schemaSyncedAt.getTime() > SCHEMA_MAX_AGE;
  if (stale || refreshSchema) {
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

/**
 * Steam ne dit pas qu'un joueur garde son temps de jeu privé : il renvoie simplement zéro
 * partout. Une bibliothèque entière à zéro, chez quelqu'un qui y a pourtant des succès, ne peut
 * être que ce réglage : sa page de compte l'invite alors à le rendre public. Les temps déjà
 * enregistrés ne sont pas les siens : ils sont effacés.
 */
async function notePlaytimePrivacy(
  userId: string,
  account: { id: string; playtimeHidden: boolean },
  games: OwnedGame[],
) {
  const silent = games.length > 0 && games.every((game) => !game.playtime_forever);
  const hidden =
    silent &&
    (await db.userAchievement.count({
      where: { userId, achievement: { game: { platform: 'STEAM' } } },
      take: 1,
    })) > 0;
  if (hidden) {
    await db.userGame.updateMany({
      where: { userId, playtimeMinutes: { gt: 0 }, game: { platform: 'STEAM' } },
      data: { playtimeMinutes: 0 },
    });
  }
  if (hidden !== account.playtimeHidden) {
    await db.linkedAccount.update({ where: { id: account.id }, data: { playtimeHidden: hidden } });
  }
}

export const syncSteam: ProviderSync = async ({
  userId,
  account,
  report,
  onUnlocked,
  yieldSlot,
}) => {
  const steamId = account.providerUserId;
  const everything = await fetchOwnedGames(steamId);
  const owned = everything.filter((g) => g.has_community_visible_stats);
  const library = new Set(owned.map((game) => game.appid));
  const activeAppId = (await fetchPlayingGames([steamId]).catch(() => null))?.get(steamId);
  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'STEAM' } },
    select: {
      unlockedCount: true,
      lastPlayedAt: true,
      playtimeMinutes: true,
      achievementsCheckedAt: true,
      game: {
        select: {
          id: true,
          name: true,
          platformGameId: true,
          totalAchievements: true,
          schemaSyncedAt: true,
        },
      },
    },
  });
  const knownProgress = new Map(previous.map((row) => [row.game.platformGameId, row]));

  // La bibliothèque fait foi : jeux possédés, partagés en famille, gratuits lancés. Steam ne
  // cache des jeux qu'à un joueur dont le temps de jeu est privé (ses jeux gratuits) : le site le
  // lui dit sur sa page de compte, et ne suit plus ce que Steam ne liste pas.
  const items = owned;

  // Une méthode non documentée peut disparaître : sans elle, la règle des 24 heures reprend.
  const counts = await achievementCounts(
    steamId,
    items.map((game) => game.appid),
  ).catch((cause) => {
    log.error('Décomptes Steam :', cause);
    return null;
  });

  // Les jeux jamais vus sans aucun succès : s'ils sont au catalogue, rien n'est à lire chez Steam.
  const fresh = items.filter(
    (game) => !knownProgress.has(String(game.appid)) && counts?.get(game.appid)?.unlocked === 0,
  );
  const catalog = fresh.length
    ? await db.game.findMany({
        where: {
          platform: 'STEAM',
          platformGameId: { in: fresh.map((game) => String(game.appid)) },
          schemaSyncedAt: { gte: new Date(Date.now() - SCHEMA_MAX_AGE) },
        },
        select: { id: true, platformGameId: true },
      })
    : [];
  const inCatalog = new Map(catalog.map((game) => [game.platformGameId, game.id]));

  let achievements = 0;

  const games = await syncGames(
    items,
    { platform: 'Steam', concurrency: concurrency(), name: (g) => g.name, report, yieldSlot },
    async (ownedGame) => {
      const appId = String(ownedGame.appid);
      const borrowed = !library.has(ownedGame.appid);
      const playedAt = ownedGame.rtime_last_played
        ? new Date(ownedGame.rtime_last_played * 1000)
        : null;
      const minutes = ownedGame.playtime_forever ?? 0;
      const known = knownProgress.get(appId);
      const count = counts?.get(ownedGame.appid);
      const playing = appId === activeAppId;

      let refreshSchema = false;
      if (!playing && known && count) {
        // Steam vient de dire combien de succès le joueur a sur ce jeu : s'il n'y en a pas un de
        // plus, il n'y a rien à lire. Seul le temps de jeu peut avoir bougé.
        refreshSchema =
          count.total !== known.game.totalAchievements &&
          Date.now() - (known.game.schemaSyncedAt?.getTime() ?? 0) > ACHIEVEMENT_RECHECK;
        if (count.unlocked === known.unlockedCount && !refreshSchema) {
          const played = borrowed ? ownedGame.playtime_forever : minutes;
          if (played !== undefined && played !== known.playtimeMinutes) {
            await db.userGame.update({
              where: { userId_gameId: { userId, gameId: known.game.id } },
              data: { playtimeMinutes: played, ...(playedAt && { lastPlayedAt: playedAt }) },
            });
          }
          return;
        }
      } else if (!playing && known) {
        // Sans décompte : le temps de jeu ne prouve pas l'absence de nouveaux succès (publication
        // tardive, déblocage rétroactif). Une vraie lecture par jour couvre les jeux sans activité.
        const checkedAt = known.achievementsCheckedAt?.getTime();
        const checkedRecently =
          checkedAt !== undefined && Date.now() - checkedAt < ACHIEVEMENT_RECHECK;
        if (
          checkedRecently &&
          unchangedSince(
            known,
            borrowed ? known.lastPlayedAt : playedAt,
            borrowed && ownedGame.playtime_forever === undefined ? known.playtimeMinutes : minutes,
          )
        )
          return;
      } else if (!playing && !known && inCatalog.has(appId)) {
        // Un jeu de la bibliothèque sans succès, déjà connu du site : il entre tel quel.
        await saveProgress(userId, inCatalog.get(appId)!, [], {
          achievementsCheckedAt: new Date(),
          ...(!borrowed && { playtimeMinutes: minutes, lastPlayedAt: playedAt }),
        });
        return;
      }

      const { game, gained } = await syncSteamGame(
        userId,
        steamId,
        ownedGame,
        borrowed,
        refreshSchema,
      );
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  // Tous les jeux viennent d'être vérifiés d'un coup : la date ne s'écrit qu'une fois par jour,
  // elle ne sert qu'au jour où les décomptes manqueraient.
  if (counts) {
    const dayAgo = new Date(Date.now() - ACHIEVEMENT_RECHECK);
    await db.userGame.updateMany({
      where: {
        userId,
        game: { platform: 'STEAM' },
        OR: [{ achievementsCheckedAt: null }, { achievementsCheckedAt: { lt: dayAgo } }],
      },
      data: { achievementsCheckedAt: new Date() },
    });
  }

  await notePlaytimePrivacy(userId, account, everything);

  // Le joueur a pu changer d'avatar ou de cadre sur Steam depuis sa dernière connexion.
  const identity = await fetchSteamIdentity(steamId).catch(() => null);
  if (identity)
    await applyAccountLook(account, identityLook(identity, account), identity.avatarUrl);

  return { games, achievements };
};
