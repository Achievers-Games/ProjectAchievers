import type { Platform } from '#prisma';
import { gameArt } from '#lib/art';
import { db } from '../db';
import { groupLibrary } from '../library';
import { bestCards, chosenCards } from './library';
import { publicCache } from '../public-cache';
import { MAX_SHOWCASE, publicGames } from './shared';
import type { Collector } from './leaderboard';

export interface BannerGame {
  name: string;
  slug: string;
  images: string[];
  completion: number | null;
  /** La première image est une capture plein écran : elle peut couvrir toute la page. */
  cover: boolean;
}

export const toBanner = (game: {
  name: string;
  slug: string;
  headerUrl: string;
  artUrl?: string | null;
  completion?: number | null;
}): BannerGame => ({
  name: game.name,
  slug: game.slug,
  images: game.artUrl ? [game.artUrl, ...gameArt(game.headerUrl)] : gameArt(game.headerUrl),
  completion: game.completion ?? null,
  cover: Boolean(game.artUrl),
});

/** La capture plein écran de quelques jeux, par adresse : les cartes de vitrine ne l'ont pas. */
export async function artBySlug(slugs: string[]) {
  if (!slugs.length) return new Map<string, string>();
  const rows = await db.game.findMany({
    where: { slug: { in: slugs }, artUrl: { not: null } },
    select: { slug: true, artUrl: true },
  });
  return new Map(rows.map((row) => [row.slug, row.artUrl as string]));
}

/** Le jeu le plus avancé du joueur ; à défaut, ou pour un invité, un jeu au hasard. */
async function seasonBanner(userId?: string) {
  // Une seule ligne revient de Postgres, en conservant le regroupement et l'exemplaire suivant.
  const [closest] = userId
    ? await db.$queryRaw<{ name: string; slug: string; headerUrl: string; completion: number }[]>`
    WITH versions AS (
      SELECT g.name, g.slug, g."headerUrl", g."totalAchievements", ug.completion,
        COALESCE(g."familyKey", g.id) AS family, COALESCE(g.console, g.platform::text) AS edition,
        row_number() OVER (PARTITION BY COALESCE(g."familyKey", g.id) ORDER BY ug.completion DESC, g.slug) AS position
      FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug."userId" = ${userId} AND NOT ug.hidden AND NOT g."adultOnly"
    ), finished AS (
      SELECT DISTINCT family, edition FROM versions WHERE completion >= 100
    ), next_versions AS (
      SELECT v.family, max(v.completion) AS completion
      FROM versions v LEFT JOIN finished done ON done.family = v.family AND done.edition = v.edition
      WHERE done.family IS NULL AND v.completion > 0 AND v.completion < 100
      GROUP BY v.family
    ), cards AS (
      SELECT best.name, best.slug, best."headerUrl", best."totalAchievements", best.completion,
        next_versions.completion AS next
      FROM versions best LEFT JOIN next_versions ON next_versions.family = best.family
      WHERE position = 1
    )
    SELECT name, slug, "headerUrl", COALESCE(next, completion) AS completion FROM cards
    WHERE "headerUrl" IS NOT NULL AND (next IS NOT NULL OR (completion < 100 AND "totalAchievements" > 0))
    ORDER BY COALESCE(next, completion) DESC, name, slug LIMIT 1`
    : [];
  if (closest?.headerUrl) {
    return toBanner({
      ...closest,
      headerUrl: closest.headerUrl,
      completion: closest.completion,
    });
  }

  // Un jeu pas encore classé pourrait être un jeu adulte : il ne s'affiche pas à l'accueil.
  const random = await publicCache.read('home:random-banner', async () => {
    const [game] = await db.$queryRaw<{ name: string; slug: string; headerUrl: string }[]>`
    SELECT name, slug, "headerUrl"
    FROM "Game"
    WHERE NOT "adultOnly" AND "headerUrl" IS NOT NULL AND "totalAchievements" > 0
      AND (platform <> 'STEAM' OR "contentCheckedAt" IS NOT NULL)
    ORDER BY random()
    LIMIT 1`;
    return game;
  });
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

/** Les jeux qui peuvent habiller l'accueil : les plus joués du site, relus toutes les heures. */
const backdropPool = () =>
  publicCache.read(
    'home:backdrops',
    () =>
      db.game.findMany({
        // Seuls les jeux qui ont une capture plein écran : un bandeau ne remplit pas l'accueil.
        where: { ...publicGames, headerUrl: { not: null }, artUrl: { not: null } },
        orderBy: [{ players: { _count: 'desc' } }, { id: 'asc' }],
        take: 120,
        select: { name: true, slug: true, headerUrl: true, artUrl: true },
      }),
    3_600_000,
  );

/** Un jeu au hasard pour le fond de l'accueil : un autre à chaque visite. */
export async function homeBackdrop(random = Math.random) {
  const pool = await backdropPool();
  const game = pool[Math.floor(random() * pool.length)];
  return game?.headerUrl ? toBanner({ ...game, headerUrl: game.headerUrl }) : null;
}
