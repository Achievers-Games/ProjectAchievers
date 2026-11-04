import { db } from '../db';
import { listGames } from './library';
import { userProfile } from './profile';
import type { Collector } from './leaderboard';

export interface BannerGame {
  name: string;
  slug: string;
  images: string[];
  completion: number | null;
}

/** Steam a une grande image pour la plupart des jeux ; l'en-tête prend le relais sinon. */
const bannerImages = (headerUrl: string) =>
  headerUrl.endsWith('/header.jpg')
    ? [headerUrl.replace('/header.jpg', '/library_hero.jpg'), headerUrl]
    : [headerUrl];

export const toBanner = (game: {
  name: string;
  slug: string;
  headerUrl: string;
  completion?: number | null;
}): BannerGame => ({
  name: game.name,
  slug: game.slug,
  images: bannerImages(game.headerUrl),
  completion: game.completion ?? null,
});

/** Le jeu le plus avancé du joueur ; à défaut, ou pour un invité, un jeu au hasard. */
async function seasonBanner(userId?: string) {
  const library = userId
    ? await listGames({ sort: 'progression', page: 1, ownerId: userId, status: 'restants' }, userId)
    : null;
  const closest = library?.games.find((game) => game.headerUrl);
  if (closest?.headerUrl) {
    return toBanner({
      ...closest,
      headerUrl: closest.headerUrl,
      completion: closest.next?.completion ?? closest.progress?.completion,
    });
  }

  // Un jeu pas encore classé pourrait être un jeu adulte : il ne s'affiche pas à l'accueil.
  const [random] = await db.$queryRaw<{ name: string; slug: string; headerUrl: string }[]>`
    SELECT name, slug, "headerUrl"
    FROM "Game"
    WHERE NOT "adultOnly" AND "headerUrl" IS NOT NULL AND "totalAchievements" > 0
      AND (platform <> 'STEAM' OR "contentCheckedAt" IS NOT NULL)
    ORDER BY random()
    LIMIT 1`;
  return random ? toBanner(random) : null;
}

/** Le numéro 1 du classement et le premier jeu de sa vitrine, comme sur son profil. */
async function rankingBanner(leader: Collector | undefined) {
  if (!leader) return { leader: null, game: null };
  const profile = await userProfile(leader.handle, null);
  const best = profile?.showcase.find((game) => game.headerUrl);
  return {
    leader,
    game: best?.headerUrl ? toBanner({ ...best, headerUrl: best.headerUrl }) : null,
  };
}

export async function homeBanners(firstCollector: Collector | undefined, userId?: string) {
  const [season, { leader, game }] = await Promise.all([
    seasonBanner(userId),
    rankingBanner(firstCollector),
  ]);
  return { season, ranking: game, leader };
}
