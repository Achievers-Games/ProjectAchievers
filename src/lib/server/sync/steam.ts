import { db } from '../db';
import { env } from '../env';
import { fetchRetry, mapLimit, SyncError } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync } from './types';

const API = 'https://api.steampowered.com';
const CDN = 'https://cdn.cloudflare.steamstatic.com/steam/apps';
const SCHEMA_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

export interface OwnedGame {
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

export async function fetchOwnedGames(steamId: string): Promise<OwnedGame[]> {
  const response = await steamGet('/IPlayerService/GetOwnedGames/v1/', {
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
  });
  if (!response.ok) throw new Error(`GetOwnedGames a répondu ${response.status}`);
  const data = (await response.json()) as { response?: { games?: OwnedGame[] } };
  // Steam répond 200 avec un objet vide quand les détails de jeu sont privés.
  if (!data.response?.games) {
    throw new SyncError(
      'Ton profil Steam est privé. Rends « Détails des jeux » public, puis relance la synchronisation.',
    );
  }
  return data.response.games;
}

export const mapSchema = (
  achievements: SchemaAchievement[],
  rarity: Map<string, number>,
): AchievementInput[] =>
  achievements.map((a) => ({
    platformAchievementId: a.name,
    name: a.displayName || a.name,
    description: a.description ?? '',
    iconUrl: a.icon,
    iconLockedUrl: a.icongray,
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

async function fetchUnlocks(steamId: string, appId: number) {
  const response = await steamGet('/ISteamUserStats/GetPlayerAchievements/v1/', {
    steamid: steamId,
    appid: appId,
  });
  // 400 : le jeu n'a pas de statistiques. Ce n'est pas une erreur du joueur.
  if (response.status === 400) return [];
  if (response.status === 403) {
    throw new SyncError(
      'Tes succès Steam sont privés. Rends « Détails des jeux » public, puis relance la synchronisation.',
    );
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

  let processed = 0;
  let achievements = 0;

  await mapLimit(owned, CONCURRENCY, async (owned_game) => {
    const appId = String(owned_game.appid);
    const playedAt = owned_game.rtime_last_played
      ? new Date(owned_game.rtime_last_played * 1000)
      : null;
    const known = lastPlayed.get(appId);

    // Un jeu non relancé depuis la dernière synchronisation ne peut pas avoir changé.
    const unchanged = lastPlayed.has(appId) && known?.getTime() === playedAt?.getTime();

    if (!unchanged) {
      const game = await upsertGame({
        platform: 'STEAM',
        platformGameId: appId,
        name: owned_game.name,
        coverUrl: `${CDN}/${appId}/library_600x900.jpg`,
        headerUrl: `${CDN}/${appId}/header.jpg`,
      });

      const stale =
        !game.schemaSyncedAt || Date.now() - game.schemaSyncedAt.getTime() > SCHEMA_MAX_AGE;
      if (stale) {
        const schema = await fetchSchema(owned_game.appid);
        if (schema) await saveAchievements(game.id, schema);
      }

      const unlocks = await fetchUnlocks(steamId, owned_game.appid);
      const gained = await saveProgress(userId, game.id, unlocks, {
        playtimeMinutes: owned_game.playtime_forever ?? 0,
        lastPlayedAt: playedAt,
      });
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    }

    processed += 1;
    report(processed, owned.length, owned_game.name);
  });

  return { games: processed, achievements };
};
