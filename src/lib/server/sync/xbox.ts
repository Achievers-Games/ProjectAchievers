import { db } from '../db';
import { decrypt, encrypt } from '../crypto';
import { logger } from '#lib/logger';
import {
  openXboxSession,
  refreshMicrosoftTokens,
  XboxAuthError,
  type XboxSession,
} from '../providers/xbox';
import { fetchRetry, SyncError, syncGames } from './errors';
import {
  saveAchievements,
  saveProgress,
  upsertGame,
  fillConsoles,
  type AchievementInput,
  type UnlockInput,
} from './store';
import type { ProviderSync } from './types';
import { xboxConsole } from '#lib/collection';

const log = logger('Xbox');
const CONCURRENCY = 3;
const MAX_TITLES = 10_000;

interface XboxTitle {
  titleId: string;
  name: string;
  displayImage?: string;
  devices?: string[];
  achievement?: {
    currentAchievements?: number;
    totalAchievements?: number;
    currentGamerscore?: number;
    totalGamerscore?: number;
  };
  titleHistory?: { lastTimePlayed?: string };
}

export interface XboxAchievement {
  id: string;
  name: string;
  description?: string;
  lockedDescription?: string;
  isSecret?: boolean;
  progressState?: string;
  progression?: { timeUnlocked?: string };
  mediaAssets?: { url?: string }[];
  rarity?: { currentPercentage?: number };
  rewards?: { type?: string; value?: string }[];
}

/** Les jeux Xbox 360 ont leur propre format, à la version 1 du service. */
export interface Xbox360Achievement {
  id: number | string;
  name: string;
  description?: string;
  lockedDescription?: string;
  isSecret?: boolean;
  gamerscore?: number;
  timeUnlocked?: string;
}

const headers = (session: XboxSession, version: string) => ({
  Authorization: session.authorization,
  'x-xbl-contract-version': version,
  'Accept-Language': 'fr-FR',
  Accept: 'application/json',
});

export function mapXboxAchievement(a: XboxAchievement): AchievementInput {
  const gamerscore = Number(a.rewards?.find((r) => r.type === 'Gamerscore')?.value ?? 0);
  return {
    platformAchievementId: a.id,
    name: a.name,
    description: a.description || a.lockedDescription || '',
    iconUrl: a.mediaAssets?.[0]?.url,
    hidden: a.isSecret ?? false,
    trophyType: 'ACHIEVEMENT',
    globalRarity: a.rarity?.currentPercentage ?? null,
    points: gamerscore,
  };
}

export const mapXbox360Achievement = (a: Xbox360Achievement): AchievementInput => ({
  platformAchievementId: String(a.id),
  name: a.name,
  description: a.description || a.lockedDescription || '',
  hidden: a.isSecret ?? false,
  trophyType: 'ACHIEVEMENT',
  points: a.gamerscore ?? 0,
});

/** Un succès sans date reprend celle du dernier lancement du jeu : il reste compté. */
export function xboxUnlocks(list: XboxAchievement[], fallback: Date): UnlockInput[] {
  return list
    .filter((a) => a.progressState?.toLowerCase() === 'achieved')
    .map((a) => ({
      platformAchievementId: a.id,
      unlockedAt: a.progression?.timeUnlocked ? new Date(a.progression.timeUnlocked) : fallback,
    }));
}

/** TitleHub laisse parfois le total à zéro sur les jeux récents : tout indice de succès suffit. */
export const hasAchievements = ({ achievement }: XboxTitle) =>
  Boolean(
    achievement?.totalAchievements ||
    achievement?.currentAchievements ||
    achievement?.totalGamerscore ||
    achievement?.currentGamerscore,
  );

/** Microsoft donne ces images en http et en très grand : le navigateur doit les réécrire. */
export function xboxImage(url: string | undefined) {
  if (!url) return url;
  const secure = url.replace(/^http:/, 'https:');
  return secure.includes('store-images.s-microsoft.com') && !secure.includes('?')
    ? `${secure}?w=920`
    : secure;
}

async function fetchTitles(session: XboxSession): Promise<XboxTitle[]> {
  const url = new URL(
    `https://titlehub.xboxlive.com/users/xuid(${session.xuid})/titles/titlehistory` +
      '/decoration/achievement,image',
  );
  url.searchParams.set('maxItems', String(MAX_TITLES));
  const response = await fetchRetry(url, { headers: headers(session, '2') });
  if (!response.ok) throw new Error(`TitleHub a répondu ${response.status}`);
  const data = (await response.json()) as { titles?: XboxTitle[] };
  return data.titles ?? [];
}

async function fetchPages<T>(
  session: XboxSession,
  titleId: string,
  resource: 'achievements' | 'titleachievements' = 'achievements',
  version = '2',
) {
  const achievements: T[] = [];
  let token: string | null = null;
  do {
    const url = new URL(
      `https://achievements.xboxlive.com/users/xuid(${session.xuid})/${resource}`,
    );
    url.searchParams.set('titleId', titleId);
    url.searchParams.set('maxItems', '200');
    if (token) url.searchParams.set('continuationToken', token);

    const response = await fetchRetry(url, { headers: headers(session, version) });
    if (!response.ok) throw new Error(`Achievements a répondu ${response.status}`);
    const page = (await response.json()) as {
      achievements?: T[];
      pagingInfo?: { continuationToken?: string | null };
    };
    achievements.push(...(page.achievements ?? []));
    token = page.pagingInfo?.continuationToken ?? null;
  } while (token);
  return achievements;
}

async function readTitle(session: XboxSession, titleId: string, lastPlayed: Date) {
  const list = await fetchPages<XboxAchievement>(session, titleId);
  if (list.length) {
    return {
      achievements: list.map(mapXboxAchievement),
      unlocks: xboxUnlocks(list, lastPlayed),
      states: list.map((a) => a.progressState ?? 'absent'),
    };
  }

  const [all, earned] = await Promise.all([
    // Une liste vide peut aussi être un jeu récent sans succès, inconnu de ce service.
    fetchPages<Xbox360Achievement>(session, titleId, 'titleachievements', '1').catch(() => []),
    fetchPages<Xbox360Achievement>(session, titleId, 'achievements', '1').catch(() => []),
  ]);
  return {
    achievements: all.map(mapXbox360Achievement),
    unlocks: earned.map((a) => ({
      platformAchievementId: String(a.id),
      unlockedAt: a.timeUnlocked ? new Date(a.timeUnlocked) : lastPlayed,
    })),
    states: earned.map(() => 'Achieved'),
  };
}

async function connect(account: Parameters<ProviderSync>[0]['account']): Promise<XboxSession> {
  if (!account.refreshTokenEnc) {
    throw new SyncError('sync_xbox_relink', true);
  }
  try {
    const tokens = await refreshMicrosoftTokens(decrypt(account.refreshTokenEnc));
    await db.linkedAccount.update({
      where: { id: account.id },
      data: {
        accessTokenEnc: encrypt(tokens.accessToken),
        refreshTokenEnc: encrypt(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
      },
    });
    return await openXboxSession(tokens.accessToken);
  } catch (cause) {
    // Une panne passagère ne doit pas obliger le joueur à relier son compte.
    if (cause instanceof XboxAuthError) throw new SyncError('sync_xbox_expired', true);
    throw cause;
  }
}

export const syncXbox: ProviderSync = async ({ userId, account, report, onUnlocked }) => {
  const session = await connect(account);
  const history = await fetchTitles(session);
  const titles = history.filter(hasAchievements);

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'XBOX' } },
    select: { unlockedCount: true, game: { select: { platformGameId: true } } },
  });
  const known = new Map(previous.map((p) => [p.game.platformGameId, p.unlockedCount]));
  await fillConsoles('XBOX', new Map(titles.map((t) => [t.titleId, xboxConsole(t.devices)])));

  let achievements = 0;
  const states = new Map<string, number>();

  const games = await syncGames(
    titles,
    { platform: 'Xbox', concurrency: CONCURRENCY, name: (t) => t.name, report },
    async (title) => {
      if (known.get(title.titleId) === title.achievement?.currentAchievements) return;

      const game = await upsertGame({
        platform: 'XBOX',
        platformGameId: title.titleId,
        name: title.name,
        coverUrl: xboxImage(title.displayImage),
        headerUrl: xboxImage(title.displayImage),
        console: xboxConsole(title.devices),
      });

      const played = title.titleHistory?.lastTimePlayed;
      const lastPlayed = played ? new Date(played) : null;
      const read = await readTitle(session, title.titleId, lastPlayed ?? new Date());
      await saveAchievements(game.id, read.achievements);
      for (const state of read.states) states.set(state, (states.get(state) ?? 0) + 1);

      const gained = await saveProgress(userId, game.id, read.unlocks, {
        lastPlayedAt: lastPlayed,
      });
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  // Des totaux seulement : assez pour comprendre un import vide, sans donnée du joueur.
  log.info(
    `Xbox : ${history.length} titres, ${titles.length} avec succès, états`,
    Object.fromEntries(states),
  );
  return { games, achievements };
};
