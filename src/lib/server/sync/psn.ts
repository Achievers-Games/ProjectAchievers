import {
  getTitleTrophies,
  getUserPlayedGames,
  getUserTrophiesForSpecificTitle,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  type TrophyTitle,
} from 'psn-api';
import type { TrophyType } from '#prisma';
import { psnConsole } from '#lib/collection';
import { logger } from '#lib/logger';
import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import { db } from '../db';
import { recordCompletionTimes } from '../completion-time';
import { env } from '../env';
import { psnAuthorization } from '../providers/psn';
import { rateLimit } from '../rate-limit';
import { SyncError, syncGames } from './errors';
import {
  fillConsoles,
  saveAchievements,
  saveProgress,
  upsertGame,
  type AchievementInput,
} from './store';
import type { ProviderSync } from './types';

const PAGE = 800;
const log = logger('PlayStation');
const PLAYTIME_EVERY = 6 * 60 * 60 * 1000;

/**
 * Retient le dernier lancement d'un jeu, d'après la liste des jeux joués de Sony. Une date
 * absente ou illisible ne compte pas ; la plus récente l'emporte si le jeu revient deux fois.
 */
export function noteLaunch(launched: Map<string, Date>, titleId: string, when?: string | null) {
  const at = when ? new Date(when) : null;
  if (!at || Number.isNaN(at.getTime())) return;
  if (at > (launched.get(titleId) ?? new Date(0))) launched.set(titleId, at);
}

async function syncPsnPlaytime(userId: string, accountId: string, titles: TrophyTitle[]) {
  const authorization = await psnAuthorization();
  const trophyIds = new Set(titles.map((title) => title.npCommunicationId));
  const played = new Map<string, number>();
  // Le dernier lancement de chaque jeu, que Sony donne avec le temps de jeu : la date des
  // trophées ne bouge pas quand on joue sans en gagner, et le rail des amis restait figé.
  const launched = new Map<string, Date>();
  const limit = 100;
  for (let offset = 0; ;) {
    const page = await getUserPlayedGames(authorization, accountId, {
      categories: 'ps4_game,ps5_native_game',
      limit,
      offset,
    });
    assertPsnResponse(page);
    for (const { titleId, playDuration, lastPlayedDateTime } of page.titles) {
      if (!/^(?:CUSA|PPSA)\d+(?:_\d+)?$/u.test(titleId)) continue;
      noteLaunch(launched, titleId, lastPlayedDateTime);
      const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/u.exec(playDuration);
      if (!duration || !duration.slice(1).some(Boolean)) continue;
      const seconds =
        Number(duration[1] ?? 0) * 3600 + Number(duration[2] ?? 0) * 60 + Number(duration[3] ?? 0);
      if (Number.isFinite(seconds))
        played.set(titleId, Math.max(played.get(titleId) ?? 0, seconds));
    }
    const next = page.nextOffset ?? offset + page.titles.length;
    if (next <= offset || next >= page.totalItemCount || !page.titles.length) break;
    offset = next;
  }

  const totals = new Map<string, { ps4: number; ps5: number }>();
  const lastPlayed = new Map<string, Date>();
  const ids = [...played.keys()];
  for (let offset = 0; offset < ids.length; offset += 5) {
    const batch = ids.slice(offset, offset + 5);
    const response = await getUserTrophiesForSpecificTitle(authorization, accountId, {
      npTitleIds: batch.join(','),
    });
    assertPsnResponse(response);
    for (const titleId of batch) {
      const matches = new Set(
        response.titles
          .filter((title) => title.npTitleId === titleId)
          .flatMap((title) => (title.trophyTitles ?? []).map((trophy) => trophy.npCommunicationId))
          .filter((id) => trophyIds.has(id)),
      );
      if (matches.size !== 1) continue;
      const [id] = matches;
      if (!id) continue;
      const total = totals.get(id) ?? { ps4: 0, ps5: 0 };
      const console = titleId.startsWith('CUSA') ? 'ps4' : 'ps5';
      total[console] += played.get(titleId) ?? 0;
      totals.set(id, total);
      // Les versions PS4 et PS5 d'une même liste de trophées : la plus récente compte.
      const at = launched.get(titleId);
      if (at && at > (lastPlayed.get(id) ?? new Date(0))) lastPlayed.set(id, at);
    }
  }

  const readings: { id: string; minutes: number }[] = [];
  for (const [platformGameId, seconds] of totals) {
    const ps4PlaytimeMinutes = Math.floor(seconds.ps4 / 60);
    const ps5PlaytimeMinutes = Math.floor(seconds.ps5 / 60);
    const playtimeMinutes = ps4PlaytimeMinutes + ps5PlaytimeMinutes;
    if (playtimeMinutes > 2_147_483_647) continue;
    readings.push({ id: platformGameId, minutes: playtimeMinutes });
    await db.userGame.updateMany({
      where: {
        userId,
        OR: [
          { playtimeMinutes: { not: playtimeMinutes } },
          { ps4PlaytimeMinutes: { not: ps4PlaytimeMinutes } },
          { ps5PlaytimeMinutes: { not: ps5PlaytimeMinutes } },
        ],
        game: { platform: 'PSN', platformGameId },
      },
      data: { playtimeMinutes, ps4PlaytimeMinutes, ps5PlaytimeMinutes },
    });
  }
  await recordCompletionTimes(db, userId, readings, 'PSN');

  // Une date connue plus récente (un trophée gagné depuis) reste en place.
  for (const [platformGameId, at] of lastPlayed) {
    await db.userGame.updateMany({
      where: {
        userId,
        game: { platform: 'PSN', platformGameId },
        OR: [{ lastPlayedAt: null }, { lastPlayedAt: { lt: at } }],
      },
      data: { lastPlayedAt: at },
    });
  }
}

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

const PRIVATE_TROPHIES = 2240526;

/** psn-api renvoie certaines erreurs de Sony comme une réponse normale. */
export function assertPsnResponse(response: object) {
  const { error } = response as { error?: { code?: number; message?: string } };
  if (!error) return;
  if (error.code === PRIVATE_TROPHIES) {
    throw new SyncError('sync_psn_private');
  }
  throw new Error(`PSN a répondu ${error.code} : ${error.message}`);
}

const PSN_LANGUAGES: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  'pt-BR': 'pt-BR',
  ru: 'ru-RU',
  'zh-CN': 'zh-Hans',
  ja: 'ja-JP',
};

/** Le service dépend de la génération du jeu, qui n'est pas conservée : PS5 d'abord. */
export async function fetchPsnTexts(titleId: string, locale: Locale) {
  const authorization = await psnAuthorization();
  const headerOverrides = { 'Accept-Language': PSN_LANGUAGES[locale] };
  const read = (npServiceName: 'trophy' | 'trophy2') =>
    getTitleTrophies(authorization, titleId, 'all', { npServiceName, headerOverrides });

  let catalog = await read('trophy2');
  if (!catalog.trophies) catalog = await read('trophy');
  assertPsnResponse(catalog);
  return catalog.trophies.map((trophy) => ({
    platformAchievementId: String(trophy.trophyId),
    name: trophy.trophyName ?? '',
    description: trophy.trophyDetail ?? '',
  }));
}

async function allTitles(accountId: string) {
  const authorization = await psnAuthorization();
  const titles: TrophyTitle[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await getUserTitles(authorization, accountId, { limit: PAGE, offset });
    assertPsnResponse(page);
    titles.push(...page.trophyTitles);
    if (!page.nextOffset) return titles;
  }
}

export const syncPsn: ProviderSync = async ({ userId, account, report, onUnlocked, yieldSlot }) => {
  const accountId = account.providerUserId;

  const titles = await allTitles(accountId);

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'PSN' } },
    select: { unlockedCount: true, game: { select: { platformGameId: true } } },
  });
  const known = new Map(previous.map((p) => [p.game.platformGameId, p.unlockedCount]));
  await fillConsoles(
    'PSN',
    new Map(titles.map((t) => [t.npCommunicationId, psnConsole(t.trophyTitlePlatform)])),
  );

  let achievements = 0;
  let reread = false;

  const games = await syncGames(
    titles,
    {
      platform: 'PSN',
      concurrency: env().SYNC_GAME_CONCURRENCY,
      name: (t) => t.trophyTitleName,
      report,
      yieldSlot,
    },
    async (title) => {
      // PSN donne le total obtenu par jeu : inutile de relire un jeu sans nouveauté.
      const earned = Object.values(title.earnedTrophies).reduce((sum, n) => sum + n, 0);
      if (known.get(title.npCommunicationId) === earned) return;
      reread = true;

      const authorization = await psnAuthorization();
      const options = { npServiceName: title.npServiceName };
      const game = await upsertGame({
        platform: 'PSN',
        platformGameId: title.npCommunicationId,
        name: title.trophyTitleName,
        coverUrl: title.trophyTitleIconUrl,
        headerUrl: title.trophyTitleIconUrl,
        console: psnConsole(title.trophyTitlePlatform),
      });

      // Dans la langue de base du site, comme Steam : sans elle, Sony répond dans celle du compte
      // de service, et les noms ne se comparent plus d'une plateforme à l'autre (familles, guides).
      const catalog = await getTitleTrophies(authorization, title.npCommunicationId, 'all', {
        ...options,
        headerOverrides: { 'Accept-Language': PSN_LANGUAGES[baseLocale] },
      });
      const progress = await getUserTrophiesEarnedForTitle(
        authorization,
        accountId,
        title.npCommunicationId,
        'all',
        options,
      );
      assertPsnResponse(catalog);
      assertPsnResponse(progress);

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
      // Sony rend tous les trophées du jeu, obtenus ou non : la liste est complète.
      const { gained } = await saveProgress(
        userId,
        game.id,
        unlocks,
        { lastPlayedAt: new Date(title.lastUpdatedDateTime) },
        { complete: true },
      );
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  // Après une partie (un trophée de plus), ou au plus toutes les six heures : relire le temps de
  // chaque jeu à chaque visite coûtait une trentaine d'appels à Sony pour rien.
  if (reread || rateLimit(`psn-temps:${userId}`, 1, PLAYTIME_EVERY)) {
    await syncPsnPlaytime(userId, accountId, titles).catch((cause) => {
      log.warn('Temps de jeu PSN indisponible :', cause);
    });
  }
  return { games, achievements };
};
