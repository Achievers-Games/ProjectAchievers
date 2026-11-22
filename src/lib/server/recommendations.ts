import { Prisma, type Platform } from '#prisma';
import { db } from './db';
import { PublicCache } from './public-cache';

/** Les rangées de l'accueil défilent comme le direct : douze jeux chacune. */
const RAIL = 12;
/** Les mieux classés, avant d'écarter les jeux hors de portée : de quoi remplir la rangée. */
const POOL = 36;
/** En dessous, les goûts du joueur ne se devinent pas : l'accueil garde « Presque terminés ». */
export const MIN_LIKED = 5;
/** Un jeu dit quelque chose des goûts du joueur à partir de là. */
const LIKED_COMPLETION = 20;
const LIKED_MINUTES = 300;
/** Lancé pour voir, ou jamais : le jeu est encore à commencer. */
const UNTOUCHED_MINUTES = 60;
const FINISHABLE_COMPLETION = 50;
/** Moins d'un joueur sur mille a son succès le plus rare : 100 % sans doute hors de portée. */
const REACHABLE_RARITY = 0.1;
/** Presque au bout, le joueur sait mieux que nous si la fin est possible. */
const ALMOST_DONE = 90;

/** Une version d'un jeu dans la bibliothèque du joueur. */
export interface OwnedVersion {
  id: string;
  name: string;
  slug: string;
  platform: Platform;
  console: string | null;
  headerUrl: string | null;
  totalAchievements: number;
  familyKey: string | null;
  tier: number | null;
  /** Étiquettes Steam, de la plus votée à la moins votée. */
  tags: number[];
  unlockedCount: number;
  completion: number;
  playtimeMinutes: number;
  hidden: boolean;
  /** Écarté par le joueur, ou bloqué par la modération. */
  dismissed: boolean;
}

type Vector = Map<number, number>;

function norm(vector: Vector) {
  let sum = 0;
  for (const weight of vector.values()) sum += weight * weight;
  return Math.sqrt(sum);
}

function dot(a: Vector, b: Vector) {
  let sum = 0;
  for (const [tag, weight] of a) sum += weight * (b.get(tag) ?? 0);
  return sum;
}

/**
 * Le profil d'un jeu : ses étiquettes, les premières pesant plus, et les plus répandues moins
 * (« Solo » ne dit rien de personne).
 */
function profile(tags: number[], rarity: Vector): Vector {
  return new Map(
    tags.map((tag, index) => [tag, (1 - (0.6 * index) / tags.length) * (rarity.get(tag) ?? 0)]),
  );
}

/**
 * Les versions d'un même jeu ne font qu'une suggestion, celle de la version la plus avancée. Un
 * jeu qui porte un nom déjà vu (deux éditions que rien ne rattache) compte avec l'autre.
 */
function families(versions: OwnedVersion[]) {
  const byName = new Map<string, string>();
  return [
    ...Map.groupBy(versions, (version) => {
      const key = version.familyKey ?? version.id;
      const name = version.name.toLowerCase();
      const known = byName.get(name);
      if (known) return known;
      byName.set(name, key);
      return key;
    }).values(),
  ].map((group) => {
    const best = group.toSorted(
      (a, b) => b.completion - a.completion || b.playtimeMinutes - a.playtimeMinutes,
    )[0]!;
    return {
      best,
      tags: group.find((version) => version.tags.length)?.tags ?? [],
      minutes: group.reduce((sum, version) => sum + version.playtimeMinutes, 0),
      completion: best.completion,
      ignored: group.some((version) => version.hidden || version.dismissed),
    };
  });
}

/**
 * Classe les jeux du joueur selon ses goûts : ceux qu'il finit et ceux où il passe du temps. Rien
 * sans assez de jeux pour les connaître.
 */
export function rankSuggestions(versions: OwnedVersion[], rarity: Vector) {
  const games = families(versions).map((game) => {
    const vector = profile(game.tags, rarity);
    return { ...game, vector, size: norm(vector) };
  });
  const liked = games
    .filter(
      (game) =>
        game.size > 0 &&
        !game.best.hidden &&
        (game.completion >= LIKED_COMPLETION || game.minutes >= LIKED_MINUTES),
    )
    .map((game) => {
      const done = game.completion / 100;
      // Finir un jeu en dit plus que l'avoir laissé tourner : les heures plafonnent.
      const weight = 2 * done * done + Math.min(Math.log1p(game.minutes / 60), 5) / 5;
      return { ...game, weight };
    });
  if (liked.length < MIN_LIKED) return null;

  const taste: Vector = new Map();
  for (const game of liked) {
    for (const [tag, weight] of game.vector) {
      taste.set(tag, (taste.get(tag) ?? 0) + (game.weight * weight) / game.size);
    }
  }

  const tasteSize = norm(taste);
  const shares = new Map(liked.map((game) => [game.best.id, game.weight / game.size]));

  /**
   * La ressemblance du jeu avec les goûts du joueur. Un jeu déjà entamé compte dans ces goûts : sa
   * part s'en retire, il ne se recommande pas lui-même. Tout se déduit des produits déjà faits :
   * recopier les goûts pour chaque jeu prenait un tiers de seconde sur le NAS.
   */
  const score = (game: (typeof games)[number]) => {
    if (!game.size) return 0;
    const common = dot(game.vector, taste);
    const share = shares.get(game.best.id) ?? 0;
    const own = share * game.size * game.size;
    const rest = Math.sqrt(
      Math.max(
        0,
        tasteSize * tasteSize - 2 * share * common + share * share * game.size * game.size,
      ),
    );
    return rest > 1e-9 ? (common - own) / (game.size * rest) : 0;
  };
  /** Le jeu aimé qui ressemble le plus à celui-ci : la raison montrée au joueur. */
  const reason = (game: (typeof games)[number]) => {
    let best: { name: string; finished: boolean } | null = null;
    let top = 0;
    for (const other of liked) {
      if (other.best.id === game.best.id) continue;
      const likeness = (dot(game.vector, other.vector) / other.size) * Math.sqrt(other.weight);
      if (likeness > top) {
        top = likeness;
        best = { name: other.best.name, finished: other.completion >= 100 };
      }
    }
    return best;
  };
  const candidates = games
    .filter(
      (game) =>
        !game.ignored &&
        game.completion < 100 &&
        game.best.totalAchievements > 0 &&
        // Seuls ceux qu'une rangée peut montrer se comparent aux goûts.
        (game.completion >= FINISHABLE_COMPLETION ||
          (game.completion === 0 && game.minutes < UNTOUCHED_MINUTES)),
    )
    .map((game) => ({ ...game, fit: score(game) }));
  const top = (list: typeof candidates, value: (game: (typeof candidates)[number]) => number) =>
    list
      .toSorted((a, b) => value(b) - value(a) || a.best.name.localeCompare(b.best.name))
      .slice(0, POOL)
      // La raison compare le jeu à tous les jeux aimés : calculée pour ceux qu'on montre seulement.
      .map((game) => ({ game: game.best, reason: () => reason(game) }));

  return {
    // Les goûts d'abord, la progression ensuite : un jeu fini à 98 % passe devant à goût égal.
    finish: top(
      candidates.filter((game) => game.completion >= FINISHABLE_COMPLETION),
      (game) => 0.6 * game.fit + (0.4 * game.completion) / 100,
    ),
    start: top(
      candidates.filter(
        (game) => game.completion === 0 && game.minutes < UNTOUCHED_MINUTES && game.fit > 0,
      ),
      (game) => game.fit,
    ),
  };
}

/** Le catalogue bouge peu : la rareté des étiquettes se relit une fois par heure. */
const rarityCache = new PublicCache(1);
const tagRarity = () =>
  rarityCache.read(
    'tags',
    async () => {
      const rows = await db.$queryRaw<{ tag: number; weight: number }[]>`
        SELECT tag, ln(total.games::float / count(*))::float AS weight
        FROM "Game", unnest(tags) AS tag,
          (SELECT count(*) AS games FROM "Game" WHERE cardinality(tags) > 0) total
        GROUP BY tag, total.games`;
      return new Map(rows.map((row) => [row.tag, row.weight]));
    },
    60 * 60 * 1000,
  );

/** Pour les tests : le catalogue vient de changer. */
export const resetTagRarity = () => rarityCache.clear();

/** Le temps du 100 % selon Lure, par la version Steam du jeu quand celle du joueur est ailleurs. */
async function completionMinutes(gameIds: string[]) {
  if (!gameIds.length) return new Map<string, number>();
  const rows = await db.$queryRaw<{ id: string; minutes: number }[]>`
    SELECT g.id, min(lure."completionistMinutes")::int AS minutes
    FROM "Game" g
    JOIN LATERAL (
      SELECT g."platformGameId" WHERE g.platform = 'STEAM'
      UNION ALL
      SELECT s."platformGameId" FROM "Game" s
      WHERE s."familyKey" = g."familyKey" AND s.platform = 'STEAM'
    ) steam ON true
    JOIN "LureGame" lure ON lure."steamAppId" = steam."platformGameId"
      AND lure.found AND lure."completionistMinutes" > 0
    WHERE g.id IN (${Prisma.join(gameIds)})
    GROUP BY g.id`;
  return new Map(rows.map((row) => [row.id, row.minutes]));
}

/** Le taux du succès le plus rare de chaque jeu, en % de joueurs. */
async function hardestRarity(gameIds: string[]) {
  if (!gameIds.length) return new Map<string, number | null>();
  const rows = await db.achievement.groupBy({
    by: ['gameId'],
    where: { gameId: { in: gameIds } },
    _min: { globalRarity: true },
  });
  return new Map(rows.map((row) => [row.gameId, row._min.globalRarity]));
}

/** Les prochains 100 % proposés au joueur sur l'accueil, ou rien si ses goûts sont inconnus. */
export async function suggestions(userId: string, showAdult = false) {
  const [versions, rarity] = await Promise.all([
    db.$queryRaw<OwnedVersion[]>`
      SELECT g.id, g.name, g.slug, g.platform::text AS platform, g.console, g."headerUrl",
        g."totalAchievements", g."familyKey", g.tier, g.tags,
        ug."unlockedCount", ug.completion, ug."playtimeMinutes", ug.hidden,
        EXISTS (
          SELECT 1 FROM "DismissedSuggestion" d
          WHERE d."userId" = ug."userId" AND d."gameId" = g.id
        ) OR EXISTS (
          -- Bloqué par la modération : sa progression est à zéro, mais il a été joué.
          SELECT 1 FROM "SteamIntegrityReview" r
          WHERE r."userId" = ug."userId" AND r."gameId" = g.id AND r."suspendedAt" IS NOT NULL
        ) AS dismissed
      FROM "UserGame" ug JOIN "Game" g ON g.id = ug."gameId"
      WHERE ug."userId" = ${userId} AND g."totalAchievements" > 0
        AND (${showAdult} OR NOT g."adultOnly")
      ORDER BY g.id`,
    tagRarity(),
  ]);
  const ranked = rankSuggestions(versions, rarity);
  if (!ranked) return null;
  const ids = [...ranked.finish, ...ranked.start].map((item) => item.game.id);
  const [minutes, hardest] = await Promise.all([completionMinutes(ids), hardestRarity(ids)]);
  const rail = (pool: typeof ranked.finish) =>
    pool
      .filter(
        ({ game }) =>
          (hardest.get(game.id) ?? 100) >= REACHABLE_RARITY || game.completion >= ALMOST_DONE,
      )
      .slice(0, RAIL)
      .map(({ game, reason }) => ({
        game: {
          id: game.id,
          name: game.name,
          slug: game.slug,
          platform: game.platform,
          console: game.console,
          headerUrl: game.headerUrl,
          totalAchievements: game.totalAchievements,
        },
        tier: game.tier ?? 1,
        progress: {
          unlockedCount: game.unlockedCount,
          completion: game.completion,
          platinum: false,
        },
        reason: reason(),
        hours: minutes.has(game.id) ? Math.round(minutes.get(game.id)! / 60) : null,
      }));
  return { finish: rail(ranked.finish), start: rail(ranked.start) };
}

/** Retire un jeu des suggestions du joueur, ou l'y remet. Faux s'il ne le possède pas. */
export async function dismissSuggestion(userId: string, gameId: string, dismissed: boolean) {
  const owned = await db.userGame.findUnique({
    where: { userId_gameId: { userId, gameId } },
    select: { gameId: true },
  });
  if (!owned) return false;
  if (dismissed) {
    await db.dismissedSuggestion.upsert({
      where: { userId_gameId: { userId, gameId } },
      create: { userId, gameId },
      update: {},
    });
  } else {
    await db.dismissedSuggestion.deleteMany({ where: { userId, gameId } });
  }
  return true;
}
