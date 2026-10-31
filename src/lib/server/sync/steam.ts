import { baseLocale, type Locale } from '$lib/paraglide/runtime';
import { applyAccountLook } from '../accounts';
import { db } from '../db';
import { env } from '../env';
import { fetchSteamLook } from '../providers/steam';
import { fetchRetry, SyncError, syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync } from './types';

const API = 'https://api.steampowered.com';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const STORE = 'https://store.steampowered.com/api/appdetails';
const SCHEMA_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

interface OwnedGame {
  appid: number;
  name: string;
  playtime_forever?: number;
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
  const data = (await response.json()) as { response?: { games?: OwnedGame[] } };
  // Steam répond 200 avec un objet vide quand les détails de jeu sont privés.
  if (!data.response?.games) {
    throw new SyncError('sync_steam_private');
  }
  return data.response.games;
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

async function fetchSchema(appId: number): Promise<AchievementInput[] | null> {
  const schemaResponse = await steamGet('/ISteamUserStats/GetSchemaForGame/v2/', {
    appid: appId,
    l: 'french',
  });
  if (!schemaResponse.ok) return null;
  const schema = (await schemaResponse.json()) as {
    game?: { availableGameStats?: { achievements?: SchemaAchievement[] } };
  };
  const achievements = schema.game?.availableGameStats?.achievements;
  if (!achievements?.length) return [];

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
  const response = await steamGet('/ISteamUserStats/GetSchemaForGame/v2/', {
    appid: appId,
    l: STEAM_LANGUAGES[locale],
  });
  if (!response.ok) throw new Error(`GetSchemaForGame a répondu ${response.status}`);
  const schema = (await response.json()) as {
    game?: { availableGameStats?: { achievements?: SchemaAchievement[] } };
  };
  const owner = await db.linkedAccount.findFirst({
    where: {
      provider: 'STEAM',
      user: { games: { some: { game: { platform: 'STEAM', platformGameId: appId } } } },
    },
    select: { providerUserId: true },
  });
  const hidden = owner ? await fetchPageDescriptions(owner.providerUserId, appId, locale) : null;

  return (schema.game?.availableGameStats?.achievements ?? []).map((a) => ({
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
    if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
  }
  return filled;
}

async function fetchUnlocks(steamId: string, appId: number) {
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

export const syncSteam: ProviderSync = async ({ userId, account, report, onUnlocked }) => {
  const steamId = account.providerUserId;
  const owned = (await fetchOwnedGames(steamId)).filter((g) => g.has_community_visible_stats);

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'STEAM' } },
    select: { lastPlayedAt: true, game: { select: { platformGameId: true } } },
  });
  const lastPlayed = new Map(previous.map((p) => [p.game.platformGameId, p.lastPlayedAt]));

  let achievements = 0;

  const games = await syncGames(
    owned,
    { platform: 'Steam', concurrency: CONCURRENCY, name: (g) => g.name, report },
    async (ownedGame) => {
      const appId = String(ownedGame.appid);
      const playedAt = ownedGame.rtime_last_played
        ? new Date(ownedGame.rtime_last_played * 1000)
        : null;

      // Un jeu non relancé depuis la dernière synchronisation ne peut pas avoir changé.
      const known = lastPlayed.get(appId);
      if (lastPlayed.has(appId) && known?.getTime() === playedAt?.getTime()) return;

      const game = await upsertGame({
        platform: 'STEAM',
        platformGameId: appId,
        name: ownedGame.name,
        ...(await steamImages(appId)),
      });

      const stale =
        !game.schemaSyncedAt || Date.now() - game.schemaSyncedAt.getTime() > SCHEMA_MAX_AGE;
      if (stale) {
        const schema = await fetchSchema(ownedGame.appid);
        if (schema) await saveAchievements(game.id, schema);
      }

      const unlocks = await fetchUnlocks(steamId, ownedGame.appid);
      const gained = await saveProgress(userId, game.id, unlocks, {
        playtimeMinutes: ownedGame.playtime_forever ?? 0,
        lastPlayedAt: playedAt,
      });
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  // Le joueur a pu changer d'avatar ou de cadre sur Steam depuis sa dernière connexion.
  await applyAccountLook(account, await fetchSteamLook(steamId));

  return { games, achievements };
};
