import type { Platform } from '@prisma/client';
import { baseLocale, type Locale } from '#lib/paraglide/runtime';
import { db } from './db';
import { rateLimit } from './rate-limit';
import { logger } from '#lib/logger';

const log = logger('Textes');
import { fetchBlizzardTexts } from './sync/blizzard';
import { fetchPsnTexts } from './sync/psn';
import { fetchSteamTexts } from './sync/steam';

export interface AchievementText {
  platformAchievementId: string;
  name: string;
  description: string;
}

const WAIT = 4_000;
const REFRESH = 30 * 86_400_000;
const REQUESTS_PER_MINUTE = 30;

const pending = new Map<string, Promise<void>>();

async function fetchTexts(
  game: { platform: Platform; platformGameId: string },
  locale: Locale,
): Promise<AchievementText[]> {
  if (game.platform === 'STEAM') return fetchSteamTexts(game.platformGameId, locale);
  if (game.platform === 'PSN') return fetchPsnTexts(game.platformGameId, locale);
  if (game.platform === 'BLIZZARD') return fetchBlizzardTexts(game.platformGameId, locale);
  // Xbox n'offre ces textes qu'avec le compte d'un joueur.
  return [];
}

async function loadTexts(
  game: { id: string; platform: Platform; platformGameId: string },
  locale: Locale,
) {
  const texts = await fetchTexts(game, locale);
  const achievements = await db.achievement.findMany({
    where: { gameId: game.id },
    select: { id: true, platformAchievementId: true },
  });
  const ids = new Map(achievements.map((a) => [a.platformAchievementId, a.id]));

  const rows = texts.flatMap(({ platformAchievementId, name, description }) => {
    const achievementId = ids.get(platformAchievementId);
    return achievementId ? [{ achievementId, locale, name, description }] : [];
  });
  // Une réponse vide ne doit pas effacer les textes déjà connus.
  if (rows.length) {
    await db.$transaction([
      db.achievementTranslation.deleteMany({
        where: { locale, achievementId: { in: rows.map((row) => row.achievementId) } },
      }),
      db.achievementTranslation.createMany({ data: rows, skipDuplicates: true }),
    ]);
  }
  await db.gameTranslation.upsert({
    where: { gameId_locale: { gameId: game.id, locale } },
    update: { checkedAt: new Date() },
    create: { gameId: game.id, locale },
  });
}

/**
 * Récupère une seule fois les textes officiels d'un jeu dans une langue, à sa première visite.
 * La page n'attend pas longtemps : si la plateforme traîne, elle s'affiche dans la langue stockée.
 */
export async function ensureGameTexts(
  game: { id: string; platform: Platform; platformGameId: string },
  locale: Locale,
) {
  // Steam, Xbox et Battle.net sont stockés en français, RetroAchievements n'existe qu'en anglais ;
  // PSN est dans la langue du compte de service.
  if (game.platform === 'XBOX' || game.platform === 'RETRO') return;
  if ((game.platform === 'STEAM' || game.platform === 'BLIZZARD') && locale === baseLocale) return;

  const known = await db.gameTranslation.findUnique({
    where: { gameId_locale: { gameId: game.id, locale } },
  });
  if (known && Date.now() - known.checkedAt.getTime() < REFRESH) return;

  const key = `${game.id}:${locale}`;
  let task = pending.get(key);
  if (!task) {
    if (!rateLimit(`textes:${game.platform}`, REQUESTS_PER_MINUTE, 60_000)) return;
    task = loadTexts(game, locale)
      .catch((cause) => log.error(`Textes ${game.platform} (${locale}) :`, cause))
      .finally(() => pending.delete(key));
    pending.set(key, task);
  }
  await Promise.race([task, new Promise((resolve) => setTimeout(resolve, WAIT))]);
}

/** Remplace les textes par ceux de la langue demandée, quand ils sont déjà connus. */
export async function localizeAchievements<
  T extends { id: string; name: string; description?: string },
>(achievements: T[], locale: Locale) {
  const rows = await db.achievementTranslation.findMany({
    where: { locale, achievementId: { in: achievements.map((a) => a.id) } },
  });
  const byId = new Map(rows.map((row) => [row.achievementId, row]));
  return achievements.map((achievement) => {
    const text = byId.get(achievement.id);
    if (!text) return achievement;
    return {
      ...achievement,
      name: text.name,
      description: text.description || achievement.description,
    };
  });
}
