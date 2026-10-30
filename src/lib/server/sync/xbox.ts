import { db } from '../db';
import { decrypt, encrypt } from '../crypto';
import { openXboxSession, refreshMicrosoftTokens, type XboxSession } from '../providers/xbox';
import { fetchRetry, SyncError, syncGames } from './errors';
import { saveAchievements, saveProgress, upsertGame, type AchievementInput } from './store';
import type { ProviderSync } from './types';

const CONCURRENCY = 3;

interface XboxTitle {
  titleId: string;
  name: string;
  displayImage?: string;
  devices?: string[];
  achievement?: { currentAchievements: number; totalAchievements: number };
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

async function fetchTitles(session: XboxSession): Promise<XboxTitle[]> {
  const url =
    `https://titlehub.xboxlive.com/users/xuid(${session.xuid})/titles/titlehistory` +
    '/decoration/achievement,image';
  const response = await fetchRetry(url, { headers: headers(session, '2') });
  if (!response.ok) throw new Error(`TitleHub a répondu ${response.status}`);
  const data = (await response.json()) as { titles?: XboxTitle[] };
  return (data.titles ?? []).filter((t) => (t.achievement?.totalAchievements ?? 0) > 0);
}

async function fetchAchievements(session: XboxSession, titleId: string) {
  const achievements: XboxAchievement[] = [];
  let token: string | null = null;
  do {
    const url = new URL(
      `https://achievements.xboxlive.com/users/xuid(${session.xuid})/achievements`,
    );
    url.searchParams.set('titleId', titleId);
    url.searchParams.set('maxItems', '200');
    if (token) url.searchParams.set('continuationToken', token);

    const response = await fetchRetry(url, { headers: headers(session, '2') });
    if (!response.ok) throw new Error(`Achievements a répondu ${response.status}`);
    const page = (await response.json()) as {
      achievements?: XboxAchievement[];
      pagingInfo?: { continuationToken?: string | null };
    };
    achievements.push(...(page.achievements ?? []));
    token = page.pagingInfo?.continuationToken ?? null;
  } while (token);
  return achievements;
}

async function connect(account: Parameters<ProviderSync>[0]['account']): Promise<XboxSession> {
  if (!account.refreshTokenEnc) {
    throw new SyncError('Reconnecte ton compte Xbox pour relancer la synchronisation.', true);
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
  } catch {
    throw new SyncError('Ton autorisation Xbox a expiré. Reconnecte ton compte.', true);
  }
}

export const syncXbox: ProviderSync = async ({ userId, account, report, onUnlocked }) => {
  const session = await connect(account);
  const titles = await fetchTitles(session);

  const previous = await db.userGame.findMany({
    where: { userId, game: { platform: 'XBOX' } },
    select: { unlockedCount: true, game: { select: { platformGameId: true } } },
  });
  const known = new Map(previous.map((p) => [p.game.platformGameId, p.unlockedCount]));

  let achievements = 0;

  const games = await syncGames(
    titles,
    { platform: 'Xbox', concurrency: CONCURRENCY, name: (t) => t.name, report },
    async (title) => {
      if (known.get(title.titleId) === title.achievement?.currentAchievements) return;

      const game = await upsertGame({
        platform: 'XBOX',
        platformGameId: title.titleId,
        name: title.name,
        coverUrl: title.displayImage,
        headerUrl: title.displayImage,
      });

      const list = await fetchAchievements(session, title.titleId);
      await saveAchievements(game.id, list.map(mapXboxAchievement));

      const unlocks = list
        .filter((a) => a.progressState === 'Achieved' && a.progression?.timeUnlocked)
        .map((a) => ({
          platformAchievementId: a.id,
          unlockedAt: new Date(a.progression?.timeUnlocked as string),
        }));
      const lastPlayed = title.titleHistory?.lastTimePlayed;
      const gained = await saveProgress(userId, game.id, unlocks, {
        lastPlayedAt: lastPlayed ? new Date(lastPlayed) : null,
      });
      achievements += gained;
      if (gained > 0) onUnlocked(game, gained);
    },
  );

  return { games, achievements };
};
