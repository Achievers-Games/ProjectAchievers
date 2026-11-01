import { db } from '../db';
import { RETRO_MEDIA, retroGet } from '../providers/retro';
import { syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync } from './types';

const PAGE = 500;
const CONCURRENCY = 2;
/** « Events » et « Hubs » du site RetroAchievements : ce ne sont pas des jeux. */
const VIRTUAL_CONSOLES = new Set([100, 101]);

interface RetroGameSummary {
  GameID: number;
  Title: string;
  ImageIcon?: string;
  ConsoleID?: number;
  MaxPossible: number;
  NumAwardedHardcore: number;
  MostRecentAwardedDate?: string | null;
}

export interface RetroAchievement {
  ID: number;
  Title: string;
  Description?: string;
  Points?: number;
  BadgeName?: string;
  NumAwardedHardcore?: number;
  DateEarnedHardcore?: string;
}

interface RetroGame {
  ImageIcon?: string;
  ImageTitle?: string;
  NumDistinctPlayersHardcore?: number;
  Achievements?: Record<string, RetroAchievement>;
}

export function mapRetroAchievement(a: RetroAchievement, players: number): AchievementInput {
  return {
    platformAchievementId: String(a.ID),
    name: a.Title,
    description: a.Description ?? '',
    iconUrl: a.BadgeName ? `${RETRO_MEDIA}/Badge/${a.BadgeName}.png` : null,
    iconLockedUrl: a.BadgeName ? `${RETRO_MEDIA}/Badge/${a.BadgeName}_lock.png` : null,
    hidden: false,
    trophyType: 'ACHIEVEMENT',
    globalRarity: players > 0 ? ((a.NumAwardedHardcore ?? 0) / players) * 100 : null,
    points: a.Points ?? 0,
  };
}

/** Le mode hardcore interdit sauvegardes d'état et triche : seul lui compte sur le site. */
export const retroUnlocks = (achievements: RetroAchievement[]) =>
  achievements.flatMap((a) =>
    a.DateEarnedHardcore
      ? [
          {
            platformAchievementId: String(a.ID),
            unlockedAt: new Date(`${a.DateEarnedHardcore.replace(' ', 'T')}Z`),
          },
        ]
      : [],
  );

async function fetchGames(ulid: string) {
  const games: RetroGameSummary[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const response = await retroGet('API_GetUserCompletionProgress.php', {
      u: ulid,
      c: PAGE,
      o: offset,
    });
    if (!response.ok) throw new Error(`RetroAchievements a répondu ${response.status}`);
    const page = (await response.json()) as { Total?: number; Results?: RetroGameSummary[] };
    games.push(...(page.Results ?? []));
    if (!page.Results?.length || games.length >= (page.Total ?? 0)) return games;
  }
}

async function fetchGame(ulid: string, gameId: number) {
  const response = await retroGet('API_GetGameInfoAndUserProgress.php', { u: ulid, g: gameId });
  if (!response.ok) throw new Error(`RetroAchievements a répondu ${response.status}`);
  return (await response.json()) as RetroGame;
}

export const syncRetro: ProviderSync = async ({ userId, account, report, onUnlocked }) => {
  const ulid = account.providerUserId;
  const list = (await fetchGames(ulid)).filter(
    (game) => game.MaxPossible > 0 && !VIRTUAL_CONSOLES.has(game.ConsoleID ?? 0),
  );

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'RETRO' } },
    select: { unlockedCount: true, game: { select: { platformGameId: true } } },
  });
  const known = new Map(previous.map((row) => [row.game.platformGameId, row.unlockedCount]));

  let achievements = 0;

  const games = await syncGames(
    list,
    { platform: 'RetroAchievements', concurrency: CONCURRENCY, name: (g) => g.Title, report },
    async (summary) => {
      const gameId = String(summary.GameID);
      // Sans déblocage hardcore de plus, inutile de relire le jeu.
      if (known.get(gameId) === summary.NumAwardedHardcore) return;

      const detail = await fetchGame(ulid, summary.GameID);
      const image = detail.ImageTitle ?? detail.ImageIcon ?? summary.ImageIcon;
      const game = await upsertGame({
        platform: 'RETRO',
        platformGameId: gameId,
        name: summary.Title,
        coverUrl: image ? `${RETRO_MEDIA}${image}` : null,
        headerUrl: image ? `${RETRO_MEDIA}${image}` : null,
      });

      const catalog = Object.values(detail.Achievements ?? {});
      const players = detail.NumDistinctPlayersHardcore ?? 0;
      await saveAchievements(
        game.id,
        catalog.map((achievement) => mapRetroAchievement(achievement, players)),
      );

      const played = summary.MostRecentAwardedDate;
      const gained = await saveProgress(userId, game.id, retroUnlocks(catalog), {
        lastPlayedAt: played ? new Date(played) : null,
      });
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  return { games, achievements };
};
