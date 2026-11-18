import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import { applyAccountLook, identityLook } from '../accounts';
import { db } from '../db';
import { env } from '../env';
import { countSteamCall } from '../steam-quota';
import { logger } from '#lib/logger';
import { fetchPlayingGames, fetchSteamIdentity } from '../providers/steam';

const log = logger('Steam');
import { fetchRetry, sleep, SyncError, syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import { matchTopAchievements } from './steam-match';
import type { ProviderSync } from './types';

const API = 'https://api.steampowered.com';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const STORE = 'https://store.steampowered.com/api/appdetails';
const SCHEMA_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const ACHIEVEMENT_RECHECK = 24 * 60 * 60 * 1000;
const concurrency = () => env().STEAM_CONCURRENCY;

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

/**
 * La date de dernier lancement à enregistrer. `GetOwnedGames` ne la donne plus : un temps de jeu
 * qui a grandi depuis la dernière lecture prouve que le joueur y a joué entre-temps, daté à la
 * lecture. `undefined` garde la date connue : un jeu sans signal ne perd jamais la sienne.
 */
export const steamPlayedAt = (
  game: Pick<OwnedGame, 'rtime_last_played' | 'playtime_forever'>,
  knownMinutes?: number,
  now = new Date(),
): Date | undefined => {
  if (game.rtime_last_played) return new Date(game.rtime_last_played * 1000);
  if (knownMinutes !== undefined && (game.playtime_forever ?? 0) > knownMinutes) return now;
  return undefined;
};

/** `GetRecentlyPlayedGames` couvre les deux dernières semaines. */
const RECENT_WINDOW = 14 * 24 * 60 * 60 * 1000;
/** Les rangs départagés à la minute, tous datés dans la fenêtre. */
const RANK_SLOTS = 60;

/**
 * Un jeu de la liste des jeux récents de Steam a été lancé ces deux dernières semaines, sans plus
 * de précision : cette liste est triée par temps de jeu sur la période, pas par date, et ne
 * porte aucune date. Sans date aussi récente en base, il est daté au début de la fenêtre : il
 * entre dans le rail des amis sans jamais passer devant un lancement vraiment daté (jeu en cours,
 * temps de jeu qui grandit). Une minute d'écart par rang garde le plus joué devant.
 * `undefined` : la date connue est déjà dans la fenêtre, elle fait foi.
 */
export const recentlyPlayedAt = (
  known: Date | null,
  rank: number,
  now = Date.now(),
): Date | undefined =>
  known && known.getTime() >= now - RECENT_WINDOW
    ? undefined
    : new Date(
        now - RECENT_WINDOW + (RANK_SLOTS - Math.min(Math.max(rank, 0), RANK_SLOTS - 1)) * 60_000,
      );

async function steamGet(path: string, params: Record<string, string | number>) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('key', env().STEAM_API_KEY ?? '');
  url.searchParams.set('format', 'json');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  countSteamCall(url);
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
 * Les jeux de la bibliothèque, en un appel : de quoi repérer un jeu acheté sans relire tous les
 * succès. Les jeux sans succès en font partie, pour leur temps de jeu. Les jeux gratuits jamais
 * lancés n'y sont pas.
 */
export async function fetchLibrary(steamId: string) {
  return ownedGames(steamId);
}

/**
 * Ceux de ces jeux que la bibliothèque liste, jeux de la famille compris, avec leur nom et leur
 * temps de jeu : `appids_filter` réduit la réponse à ces jeux (221 octets pour un, contre 95 Ko
 * pour une bibliothèque de 557 jeux).
 */
export async function fetchOwnedApps(steamId: string, appIds: number[]) {
  if (!appIds.length) return [];
  const filter = Object.fromEntries(
    appIds.map((appId, index) => [`appids_filter[${index}]`, appId]),
  );
  const wanted = new Set(appIds);
  return (await ownedGames(steamId, filter)).filter((game) => wanted.has(game.appid));
}

/** Nom et gratuité d'un jeu, selon la boutique : une seule demande par jeu tant que le site tourne. */
const appInfos = new Map<number, { name: string; free: boolean }>();

/**
 * Un jeu gratuit lancé pour la première fois n'entre dans la bibliothèque qu'une fois son temps de
 * jeu compté par Steam. La boutique dit tout de suite qu'il est gratuit, donc à tout le monde.
 * Une réponse manquante ne se garde pas : elle sera redemandée.
 */
export async function steamAppInfo(appId: number) {
  const known = appInfos.get(appId);
  if (known) return known;
  try {
    const response = await fetchRetry(`${STORE}?appids=${appId}&filters=basic`);
    const data = (await response.json()) as Record<
      string,
      { success?: boolean; data?: { name?: string; is_free?: boolean } } | undefined
    >;
    const app = data[appId]?.data;
    if (!data[appId]?.success || !app?.name) return null;
    const info = { name: app.name, free: app.is_free === true };
    appInfos.set(appId, info);
    return info;
  } catch {
    return null;
  }
}

/**
 * Ce que Steam cache encore, d'après la dernière synchronisation : la bibliothèque entière (profil
 * ou détails des jeux privés), ou seulement le temps de jeu.
 */
export type SteamPrivacy = 'library' | 'playtime';

export function steamPrivacy(account: {
  syncError: string | null;
  playtimeHidden: boolean;
}): SteamPrivacy | null {
  if (account.syncError === 'sync_steam_private') return 'library';
  return account.playtimeHidden ? 'playtime' : null;
}

/**
 * Ce que Steam montre en ce moment, en un appel léger, sans le nom des jeux : la bibliothèque, et
 * du temps de jeu. Steam n'expose pas ces réglages seuls : `probe`, des jeux où le joueur a des
 * succès donc du temps, réduit la réponse à eux.
 */
export async function steamVisibility(steamId: string, probe: number[] = []) {
  const response = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId,
    include_played_free_games: 1,
    ...Object.fromEntries(probe.map((appId, index) => [`appids_filter[${index}]`, appId])),
  });
  if (!response.ok) throw new Error(`GetOwnedGames a répondu ${response.status}`);
  const data = (await response.json()) as {
    response?: { games?: OwnedGame[]; game_count?: number };
  };
  // Même lecture que la synchronisation : un objet vide, c'est une bibliothèque cachée.
  const games = data.response?.games;
  return {
    library: !!games || typeof data.response?.game_count === 'number',
    playtime: (games ?? []).some((game) => (game.playtime_forever ?? 0) > 0),
  };
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
 * Moins que le plafond de Steam (300) : la réponse porte chaque succès obtenu, et une grosse
 * bibliothèque pesait alors des dizaines de Mo d'un coup sur le petit NAS.
 */
const TOP_PER_CALL = 100;

/**
 * Un succès obtenu, tel que GetTopAchievementsForGames le décrit. Ni identifiant technique ni
 * date : le couple `statid`/`bit` est sa position dans les statistiques du jeu.
 */
export interface TopAchievement {
  statid?: number;
  bit?: number;
  name?: string;
  desc?: string;
  icon?: string;
  hidden?: boolean;
}

export interface TopGame {
  total: number;
  achievements: TopAchievement[];
}

/**
 * Par jeu, les succès que le joueur a obtenus et le total du jeu, en français comme le catalogue.
 * C'est ce qui dit, sans lire chaque jeu, lesquels ont bougé : une bibliothèque de 700 jeux se
 * vérifie en sept appels au lieu de 700. Mesuré : un succès y apparaît quelques secondes après son
 * déblocage, quand GetPlayerAchievements met de 40 s à 5 min. Les lots partent l'un après l'autre,
 * et `onGame` lit chaque jeu avant que le lot suivant n'arrive.
 */
export async function fetchTopAchievements(
  steamId: string,
  appIds: number[],
  onGame?: (appId: number, game: TopGame) => Promise<void>,
) {
  const counts = new Map<number, { unlocked: number; total: number }>();
  for (let index = 0; index < appIds.length; index += TOP_PER_CALL) {
    const params: Record<string, string | number> = {
      steamid: steamId,
      max_achievements: ALL_ACHIEVEMENTS,
      language: 'french',
    };
    appIds
      .slice(index, index + TOP_PER_CALL)
      .forEach((appId, position) => (params[`appids[${position}]`] = appId));
    const response = await steamGet('/IPlayerService/GetTopAchievementsForGames/v1/', params);
    if (!response.ok) throw new Error(`GetTopAchievementsForGames a répondu ${response.status}`);
    const data = (await response.json()) as {
      response?: {
        games?: { appid: number; total_achievements?: number; achievements?: TopAchievement[] }[];
      };
    };
    for (const game of data.response?.games ?? []) {
      const achievements = game.achievements ?? [];
      const total = game.total_achievements ?? 0;
      counts.set(game.appid, { unlocked: achievements.length, total });
      await onGame?.(game.appid, { total, achievements });
    }
  }
  return counts;
}

/** Les succès obtenus sur un seul jeu ; `null` si Steam ne le décrit pas. */
export async function fetchTopGame(steamId: string, appId: number) {
  let found: TopGame | null = null;
  await fetchTopAchievements(steamId, [appId], async (_, game) => {
    found = game;
  });
  return found as TopGame | null;
}

/** Le nombre de succès obtenus et le total, par jeu. */
export const achievementCounts = (steamId: string, appIds: number[]) =>
  fetchTopAchievements(steamId, appIds);

/**
 * La boutique fournit la vignette officielle. Un HTTP 200 sur une ancienne URL
 * du CDN ne garantit pas que son image corresponde au jeu.
 */
export async function steamImages(appId: string | number) {
  const classic = {
    coverUrl: `${CDN}/${appId}/library_600x900.jpg`,
    headerUrl: `${CDN}/${appId}/header.jpg`,
  };
  try {
    const response = await fetchRetry(`${STORE}?appids=${appId}&filters=basic`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json()) as Record<
      string,
      { data?: { header_image?: string } } | undefined
    >;
    const image = data[appId]?.data?.header_image;
    if (!image) return classic;

    const cover = await fetch(classic.coverUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3_000),
    }).catch(() => null);
    return { coverUrl: cover?.ok ? classic.coverUrl : image, headerUrl: image };
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

/**
 * Relit la liste des succès des jeux Steam qu'au moins un joueur possède, les plus anciennes
 * d'abord. Le suivi en direct ne relit que les jeux joués : sans ce passage, une extension
 * ajoutée à un vieux jeu laissait ses joueurs à 100 % sur un total faux, et sa rareté se figeait.
 * Un appel par jeu, partagé par tous ses joueurs. Renvoie le nombre de jeux relus.
 */
export async function refreshStaleSchemas(limit = 10) {
  if (!env().STEAM_API_KEY) return 0;
  const games = await db.game.findMany({
    where: {
      platform: 'STEAM',
      players: { some: {} },
      OR: [
        { schemaSyncedAt: null },
        { schemaSyncedAt: { lt: new Date(Date.now() - SCHEMA_MAX_AGE) } },
      ],
    },
    orderBy: { schemaSyncedAt: { sort: 'asc', nulls: 'first' } },
    select: { id: true, name: true, platformGameId: true },
    take: limit,
  });
  for (const game of games) {
    const schema = await fetchSchema(Number(game.platformGameId)).catch((cause: unknown) => {
      log.error(`Liste des succès de « ${game.name} » :`, cause);
      return null;
    });
    if (schema) await saveAchievements(game.id, schema);
    // Sans réponse, le jeu repasse dans une semaine : il ne bloque pas la tête de la file.
    else await db.game.update({ where: { id: game.id }, data: { schemaSyncedAt: new Date() } });
  }
  return games.length;
}

/**
 * Le jeu au catalogue du site, avec ses images et la liste de ses succès. `statless` : Steam dit
 * déjà que le jeu n'a pas de succès (Honkai Impact 3rd) ; il entre sans succès, sans demander
 * leur liste. La relecture hebdomadaire (`refreshStaleSchemas`) verra s'il en gagne un jour.
 */
async function steamCatalogGame(source: OwnedGame, refreshSchema = false, statless = false) {
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
  if (statless) {
    if (!game.schemaSyncedAt) await saveAchievements(game.id, []);
  } else if (stale || refreshSchema) {
    const schema = await fetchSchema(source.appid);
    if (schema) await saveAchievements(game.id, schema);
  }
  return game;
}

/**
 * Un jeu neuf entre au profil sans relire toute la bibliothèque : son catalogue, puis une ligne
 * vide que le suivi en direct remplit aussitôt, avec les annonces d'un succès débloqué en jouant.
 * Un jeu sans succès (`statless`) n'y apporte que son temps de jeu.
 */
export async function addSteamGame(userId: string, source: OwnedGame, statless = false) {
  const game = await steamCatalogGame(source, false, statless);
  await saveProgress(userId, game.id, [], {
    playtimeMinutes: source.playtime_forever ?? 0,
    lastPlayedAt: source.rtime_last_played ? new Date(source.rtime_last_played * 1000) : null,
    ...(statless && { achievementsCheckedAt: new Date() }),
  });
  return game;
}

/** Lit un jeu et les succès du joueur. Sans réponse pour un jeu emprunté, le jeu est laissé. */
async function syncSteamGame(
  userId: string,
  steamId: string,
  source: OwnedGame,
  shared: boolean,
  refreshSchema = false,
  lastPlayedAt?: Date,
) {
  const game = await steamCatalogGame(source, refreshSchema);

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
        : { playtimeMinutes: source.playtime_forever ?? 0, lastPlayedAt }),
    },
    // GetPlayerAchievements rend tous les succès du joueur sur ce jeu.
    { complete: true },
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
  // Seuls les jeux qui ont des statistiques ont des succès à lire. Les autres entrent quand
  // même au profil, pour leur seul temps de jeu (Honkai Impact 3rd).
  const owned = everything.filter((g) => g.has_community_visible_stats);
  const library = new Set(everything.map((game) => game.appid));
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
  const items = everything;

  // Une méthode non documentée peut disparaître : sans elle, la règle des 24 heures reprend.
  // Elle décrit chaque succès obtenu : de quoi apprendre leur position, qui servira à les
  // reconnaître en direct, et compléter les descriptions cachées.
  const counts = await fetchTopAchievements(
    steamId,
    owned.map((game) => game.appid),
    async (appId, top) => {
      const gameId = knownProgress.get(String(appId))?.game.id;
      if (!gameId || !top.achievements.length) return;
      await matchTopAchievements(gameId, top.achievements).catch((cause) =>
        log.error('Positions des succès Steam :', cause),
      );
    },
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
      // Ce que la ligne retient du dernier lancement : maintenant si le jeu tourne.
      const lastPlayed = borrowed
        ? undefined
        : playing
          ? new Date()
          : steamPlayedAt(ownedGame, known?.playtimeMinutes);

      if (!ownedGame.has_community_visible_stats) {
        // Aucun succès à lire : seul le temps de jeu entre, ou bouge.
        if (!known) {
          await addSteamGame(userId, ownedGame, true);
        } else if (!unchangedSince(known, playedAt ?? known.lastPlayedAt, minutes)) {
          await db.userGame.update({
            where: { userId_gameId: { userId, gameId: known.game.id } },
            data: { playtimeMinutes: minutes, lastPlayedAt: lastPlayed },
          });
        }
        return;
      }

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
              data: { playtimeMinutes: played, lastPlayedAt: lastPlayed },
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
          ...(!borrowed && { playtimeMinutes: minutes, lastPlayedAt: lastPlayed }),
        });
        return;
      }

      const { game, gained } = await syncSteamGame(
        userId,
        steamId,
        ownedGame,
        borrowed,
        refreshSchema,
        lastPlayed,
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
