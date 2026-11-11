import type { Platform } from '#prisma';
import { db } from '../db';
import { groupLibrary } from '../library';
import { bestCards, chosenCards, listGames } from './library';
import { MAX_SHOWCASE } from './shared';
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

/**
 * La carte de vitrine d'un joueur : la première de sa sélection qui a une image d'en-tête.
 * Passer par `userProfile` chargeait toute sa bibliothèque et ses statistiques pour n'en garder
 * qu'une — 150 ms sur le NAS, autant que sa page de profil entière. Seules les familles dont une
 * version est terminée donnent une carte : les autres lignes ne peuvent pas changer le résultat.
 */
export async function showcaseHead(handle: string) {
  const user = await db.user.findUnique({
    where: { handle },
    select: { id: true, showcaseCustom: true },
  });
  if (!user) return null;

  // Les cartes épinglées passent devant, dans l'ordre choisi par le joueur.
  const pins = user.showcaseCustom
    ? await db.pinnedGame.findMany({
        where: { userId: user.id },
        orderBy: { position: 'asc' },
        select: { game: { select: { slug: true } } },
      })
    : [];

  const rows = await db.$queryRaw<
    {
      unlockedCount: number;
      completion: number;
      platinum: boolean;
      lastUnlockedAt: Date | null;
      id: string;
      name: string;
      slug: string;
      platform: Platform;
      console: string | null;
      coverUrl: string | null;
      headerUrl: string | null;
      totalAchievements: number;
      familyKey: string | null;
      tier: number | null;
    }[]
  >`
    SELECT ug."unlockedCount", ug."completion", ug."platinum", ug."lastUnlockedAt",
           g.id, g.name, g.slug, g.platform, g.console, g."coverUrl", g."headerUrl",
           g."totalAchievements", g."familyKey", g.tier
    FROM "UserGame" ug
    JOIN "Game" g ON g.id = ug."gameId"
    WHERE ug."userId" = ${user.id} AND NOT ug.hidden AND NOT g."adultOnly"
      AND COALESCE(g."familyKey", g.id) IN (
        SELECT COALESCE(done."familyKey", done.id)
        FROM "UserGame" finished
        JOIN "Game" done ON done.id = finished."gameId"
        WHERE finished."userId" = ${user.id} AND NOT finished.hidden
          AND NOT done."adultOnly" AND finished."completion" >= 100
      )`;

  const cards = bestCards(
    groupLibrary(
      rows.map((row) => ({
        unlockedCount: row.unlockedCount,
        completion: row.completion,
        platinum: row.platinum,
        lastUnlockedAt: row.lastUnlockedAt,
        game: {
          id: row.id,
          name: row.name,
          slug: row.slug,
          platform: row.platform,
          console: row.console,
          coverUrl: row.coverUrl,
          headerUrl: row.headerUrl,
          totalAchievements: row.totalAchievements,
          familyKey: row.familyKey,
          tier: row.tier,
        },
      })),
    ),
  );
  const chosen = chosenCards(
    cards,
    pins.map((pin) => pin.game.slug),
  );
  const showcase = (user.showcaseCustom && chosen.length ? chosen : cards).slice(0, MAX_SHOWCASE);
  return showcase.find((card) => card.headerUrl) ?? null;
}

/** Le numéro 1 du classement et le premier jeu de sa vitrine, comme sur son profil. */
async function rankingBanner(leader: Collector | undefined) {
  if (!leader) return { leader: null, game: null };
  const best = await showcaseHead(leader.handle);
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
