import {
  getTitleTrophies,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  type TrophyTitle,
} from 'psn-api';
import type { TrophyType } from '@prisma/client';
import { db } from '../db';
import { psnAuthorization } from '../providers/psn';
import { SyncError, syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync } from './types';

const PAGE = 800;
const CONCURRENCY = 3;

const TROPHY_TYPES: Record<string, TrophyType> = {
  platinum: 'PLATINUM',
  gold: 'GOLD',
  silver: 'SILVER',
  bronze: 'BRONZE',
};

export function mapTrophy(trophy: {
  trophyId: number;
  trophyType: string;
  trophyName?: string;
  trophyDetail?: string;
  trophyIconUrl?: string;
  trophyHidden: boolean;
  trophyEarnedRate?: string;
}): AchievementInput {
  return {
    platformAchievementId: String(trophy.trophyId),
    name: trophy.trophyName ?? 'Trophée caché',
    description: trophy.trophyDetail ?? '',
    iconUrl: trophy.trophyIconUrl,
    hidden: trophy.trophyHidden,
    trophyType: TROPHY_TYPES[trophy.trophyType] ?? 'BRONZE',
    globalRarity: trophy.trophyEarnedRate ? Number(trophy.trophyEarnedRate) : null,
  };
}

async function allTitles(accountId: string) {
  const authorization = await psnAuthorization();
  const titles: TrophyTitle[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await getUserTitles(authorization, accountId, { limit: PAGE, offset });
    titles.push(...page.trophyTitles);
    if (!page.nextOffset) return titles;
  }
}

export const syncPsn: ProviderSync = async ({ userId, account, report, onUnlocked }) => {
  const accountId = account.providerUserId;

  let titles: TrophyTitle[];
  try {
    titles = await allTitles(accountId);
  } catch (error) {
    if (error instanceof Error && /forbidden|2240526|privacy/i.test(error.message)) {
      throw new SyncError(
        'Tes trophées PSN sont privés. Rends-les visibles par tout le monde, puis relance la synchronisation.',
      );
    }
    throw error;
  }

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'PSN' } },
    select: { unlockedCount: true, game: { select: { platformGameId: true } } },
  });
  const known = new Map(previous.map((p) => [p.game.platformGameId, p.unlockedCount]));

  let achievements = 0;

  const games = await syncGames(
    titles,
    { platform: 'PSN', concurrency: CONCURRENCY, name: (t) => t.trophyTitleName, report },
    async (title) => {
      // PSN donne le total obtenu par jeu : inutile de relire un jeu sans nouveauté.
      const earned = Object.values(title.earnedTrophies).reduce((sum, n) => sum + n, 0);
      if (known.get(title.npCommunicationId) === earned) return;

      const authorization = await psnAuthorization();
      const options = { npServiceName: title.npServiceName };
      const game = await upsertGame({
        platform: 'PSN',
        platformGameId: title.npCommunicationId,
        name: title.trophyTitleName,
        coverUrl: title.trophyTitleIconUrl,
        headerUrl: title.trophyTitleIconUrl,
      });

      const catalog = await getTitleTrophies(
        authorization,
        title.npCommunicationId,
        'all',
        options,
      );
      const progress = await getUserTrophiesEarnedForTitle(
        authorization,
        accountId,
        title.npCommunicationId,
        'all',
        options,
      );

      const rates = new Map(progress.trophies.map((t) => [t.trophyId, t.trophyEarnedRate]));
      await saveAchievements(
        game.id,
        catalog.trophies.map((t) => mapTrophy({ ...t, trophyEarnedRate: rates.get(t.trophyId) })),
      );

      const unlocks = progress.trophies
        .filter((t) => t.earned && t.earnedDateTime)
        .map((t) => ({
          platformAchievementId: String(t.trophyId),
          unlockedAt: new Date(t.earnedDateTime as string),
        }));
      const gained = await saveProgress(userId, game.id, unlocks, {
        lastPlayedAt: new Date(title.lastUpdatedDateTime),
      });
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  return { games, achievements };
};
