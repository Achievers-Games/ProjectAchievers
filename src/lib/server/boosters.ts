import { randomInt, randomUUID } from 'node:crypto';
import { Prisma, type BoosterKind, type BoosterSource, type EditionKind } from '#prisma';
import { editionThumb, withEditionStill } from '#lib/animated-card';
import {
  BOOSTER_PRICE,
  canDraw,
  dailyStock,
  drawBooster,
  DUPLICATE_SHARDS,
  EDITIONS,
  MYTHIQUE_PITY,
  normalKind,
  type Pool,
} from '#lib/boosters';
import { GENRES } from '#lib/site-achievements';
import { completionTimes } from './completion-time';
import { db } from './db';
import { cardsOpenedAt } from './cards-launch';
import { addEntries, playtimeHidden, type Tx } from './shards';

/** Une carte sortie d'un booster, telle qu'enregistrée dans `BoosterOpening.results`. */
export interface BoosterCard {
  editionId: string;
  familyKey: string;
  kind: EditionKind;
  /** Déjà possédée : recyclée en éclats. */
  duplicate: boolean;
  shards: number;
}

export class BoosterError extends Error {
  constructor(readonly code: 'no_booster' | 'no_shards' | 'no_cards' | 'playtime_hidden') {
    super(code);
  }
}

/** Les boosters offerts ne s'accumulent qu'à partir de l'ouverture des éclats. */
const dailyFrom = (dailyAt: Date) => {
  const opening = cardsOpenedAt();
  return opening && opening > dailyAt ? opening : dailyAt;
};

/** Un nombre dans [0, 1[, tiré par le serveur : le navigateur n'a aucune prise sur le tirage. */
const secureRandom = () => randomInt(0, 2 ** 47) / 2 ** 47;

/**
 * Les éditions qui sortent des boosters, les mêmes pour tous : tout le catalogue actif, hors
 * variantes retirées et jeux réservés aux adultes. Posséder le jeu n'est pas nécessaire pour
 * tirer sa carte ; c'est le 100 % qui permet de l'afficher en bannière.
 */
export async function editionPool(tx: Tx | typeof db): Promise<Pool> {
  const rows = await tx.$queryRaw<{ editionId: string; familyKey: string; kind: EditionKind }[]>`
    SELECT e.id AS "editionId", e."familyKey", e.kind
    FROM "GameEdition" e
    JOIN "CardFamily" f ON f."familyKey" = e."familyKey" AND f.enabled AND NOT e.retired
      AND EXISTS (SELECT 1 FROM "Game" g WHERE g."familyKey" = e."familyKey")
      AND NOT EXISTS (SELECT 1 FROM "Game" g WHERE g."familyKey" = e."familyKey" AND g."adultOnly")
    ORDER BY e.id`;
  const pool = Object.fromEntries(EDITIONS.map((kind) => [kind, []])) as unknown as Pool;
  for (const row of rows) pool[row.kind].push(row);
  return pool;
}

/** Ce que la page des boosters affiche : solde, boosters offerts, garantie, éditions possibles. */
export async function boosterState(userId: string) {
  const [user, pool, hidden] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        shards: true,
        dailyBoosters: true,
        dailyAt: true,
        boostersOpened: true,
        pityMythique: true,
      },
    }),
    editionPool(db),
    playtimeHidden(db, userId),
  ]);
  return {
    playtimeHidden: hidden,
    shards: user.shards,
    daily: dailyStock(user.dailyBoosters, dailyFrom(user.dailyAt)),
    nextGolden: normalKind(user.boostersOpened) === 'GOLDEN',
    pityMythique: user.pityMythique,
    eligible: Object.fromEntries(EDITIONS.map((kind) => [kind, pool[kind].length])) as Record<
      EditionKind,
      number
    >,
    canDraw: canDraw(pool),
  };
}

/**
 * Ouvre un booster : offert (`DAILY`) ou acheté avec des éclats (`SHARDS`). Tout se passe dans
 * une transaction, et le tirage est enregistré avant d'être montré : fermer la page pendant la
 * révélation ne fait rien perdre. Deux ouvertures simultanées du même joueur s'attendent.
 */
export async function openBooster(userId: string, source: Exclude<BoosterSource, 'MISSION'>) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booster:${userId}`}, 0))::text`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { dailyBoosters: true, dailyAt: true, boostersOpened: true, pityMythique: true },
    });
    if (await playtimeHidden(tx, userId)) throw new BoosterError('playtime_hidden');
    const pool = await editionPool(tx);
    if (!canDraw(pool)) throw new BoosterError('no_cards');

    const id = randomUUID();
    const now = new Date();
    let daily = dailyStock(user.dailyBoosters, dailyFrom(user.dailyAt), now);
    if (source === 'DAILY') {
      if (daily < 1) throw new BoosterError('no_booster');
      daily -= 1;
    } else {
      // Le débit n'a lieu que si le solde suffit : jamais de solde négatif, même en parallèle.
      const paid = await tx.$executeRaw`
        UPDATE "User" SET shards = shards - ${BOOSTER_PRICE}
        WHERE id = ${userId} AND shards >= ${BOOSTER_PRICE}`;
      if (paid === 0) throw new BoosterError('no_shards');
      await tx.shardEntry.create({
        data: { userId, delta: -BOOSTER_PRICE, reason: 'BOOSTER', refId: id },
      });
    }

    const kind = normalKind(user.boostersOpened);
    const drawn = drawBooster(kind, pool, user.pityMythique, secureRandom);

    const owned = new Set(
      (
        await tx.userEdition.findMany({
          where: { userId, editionId: { in: drawn.cards.map((card) => card.editionId) } },
          select: { editionId: true },
        })
      ).map((row) => row.editionId),
    );
    const cards: BoosterCard[] = drawn.cards.map((card) => {
      const duplicate = owned.has(card.editionId);
      // Deux fois la même nouvelle carte dans un booster : la seconde est un doublon.
      owned.add(card.editionId);
      return { ...card, duplicate, shards: duplicate ? DUPLICATE_SHARDS[card.kind] : 0 };
    });

    const fresh = cards.filter((card) => !card.duplicate).map((card) => card.editionId);
    await tx.userEdition.createMany({
      data: fresh.map((editionId) => ({ userId, editionId })),
      skipDuplicates: true,
    });
    // Le verrou du joueur rend la liste des nouvelles cartes exacte : chacune gagne un propriétaire.
    if (fresh.length) {
      await tx.gameEdition.updateMany({
        where: { id: { in: fresh } },
        data: { ownerCount: { increment: 1 } },
      });
    }
    await addEntries(
      tx,
      userId,
      cards.map((card, index) => ({
        reason: 'DUPLICATE' as const,
        refId: `${id}:${index}`,
        gameId: null,
        shards: card.shards,
      })),
    );
    await tx.boosterOpening.create({
      data: { id, userId, kind, source, results: cards as object[] },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        dailyBoosters: daily,
        dailyAt: now,
        boostersOpened: { increment: 1 },
        pityMythique: drawn.pityMythique,
      },
    });
    return { id, kind, cards };
  });
}

/**
 * Un booster d'essai, pour la page de test de la modération : le vrai tirage dans le vrai
 * catalogue, sans rien payer ni rien enregistrer. Les doublons sont comptés contre la collection
 * du joueur, comme à une vraie ouverture.
 */
export async function trialBooster(userId: string, kind: BoosterKind, pityMythique: number) {
  const pool = await editionPool(db);
  if (!canDraw(pool)) throw new BoosterError('no_cards');
  const drawn = drawBooster(kind, pool, pityMythique, secureRandom);
  const owned = new Set(
    (
      await db.userEdition.findMany({
        where: { userId, editionId: { in: drawn.cards.map((card) => card.editionId) } },
        select: { editionId: true },
      })
    ).map((row) => row.editionId),
  );
  const cards: BoosterCard[] = drawn.cards.map((card) => {
    const duplicate = owned.has(card.editionId);
    owned.add(card.editionId);
    return { ...card, duplicate, shards: duplicate ? DUPLICATE_SHARDS[card.kind] : 0 };
  });
  return { id: randomUUID(), kind, cards, pityMythique: drawn.pityMythique };
}

/**
 * Ouvre `count` boosters à blanc, un doré tous les dix et la garantie de Mythique comprise, pour
 * vérifier que les pourcentages tombent juste sur le catalogue réel.
 */
export async function simulateBoosters(count: number) {
  const pool = await editionPool(db);
  if (!canDraw(pool)) throw new BoosterError('no_cards');
  const cards: Record<EditionKind, number> = { RELIEF: 0, VIVANTE: 0, MYTHIQUE: 0 };
  let pity = 0;
  let repeated = 0;
  let forced = 0;
  for (let opened = 0; opened < count; opened++) {
    const before = pity;
    const drawn = drawBooster(normalKind(opened), pool, pity, Math.random);
    pity = drawn.pityMythique;
    for (const card of drawn.cards) cards[card.kind]++;
    if (new Set(drawn.cards.map((card) => card.editionId)).size < drawn.cards.length) repeated++;
    if (before + 1 >= MYTHIQUE_PITY && pool.MYTHIQUE.length) forced++;
  }
  return {
    count,
    cards,
    repeated,
    forced,
    pool: Object.fromEntries(EDITIONS.map((kind) => [kind, pool[kind].length])) as Record<
      EditionKind,
      number
    >,
  };
}

/** Les dernières ouvertures du joueur, la plus récente d'abord. */
export async function recentOpenings(userId: string, limit = 20) {
  const rows = await db.boosterOpening.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, kind: true, source: true, results: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, cards: row.results as unknown as BoosterCard[] }));
}

/**
 * Ce qu'il faut pour afficher des cartes : le nom et l'image du jeu de chaque famille, pris sur
 * sa version la plus jouée, la plus ancienne en cas d'égalité.
 */
export async function familyArt(familyKeys: string[]) {
  if (!familyKeys.length)
    return new Map<string, { name: string; slug: string; headerUrl: string | null }>();
  const games = await db.game.findMany({
    where: { familyKey: { in: [...new Set(familyKeys)] } },
    orderBy: [{ players: { _count: 'desc' } }, { createdAt: 'asc' }],
    select: { familyKey: true, name: true, slug: true, headerUrl: true },
  });
  const art = new Map<string, { name: string; slug: string; headerUrl: string | null }>();
  for (const game of games) {
    if (game.familyKey && !art.has(game.familyKey)) art.set(game.familyKey, game);
  }
  return art;
}

/** Ce qui fait monter la tension avant de retourner une carte rare : un indice par clic. */
export interface CardClues {
  /** Les familles de genre du jeu, d'après ses étiquettes Steam les plus votées. */
  genres: string[];
  achievements: number;
  /** Temps médian pour le 100 %, en minutes, sans valeur sous 5 joueurs finis. */
  medianMinutes: number | null;
}

/** Les indices de chaque famille, tirés de sa version la plus jouée. */
export async function cardClues(familyKeys: string[]) {
  const clues = new Map<string, CardClues>();
  const keys = [...new Set(familyKeys)];
  if (!keys.length) return clues;
  const games = await db.game.findMany({
    where: { familyKey: { in: keys } },
    orderBy: [{ players: { _count: 'desc' } }, { createdAt: 'asc' }],
    select: { id: true, familyKey: true, tags: true, totalAchievements: true },
  });
  const main = new Map<string, (typeof games)[number]>();
  for (const game of games)
    if (game.familyKey && !main.has(game.familyKey)) main.set(game.familyKey, game);
  const times = await completionTimes([...main.values()].map((game) => game.id));
  const genreOf = (tag: number) =>
    (Object.entries(GENRES) as [string, { tags: readonly number[] }][]).find(([, def]) =>
      def.tags.includes(tag),
    )?.[0];
  for (const [familyKey, game] of main) {
    const genres = [...new Set(game.tags.map(genreOf).filter((key): key is string => !!key))];
    clues.set(familyKey, {
      genres: genres.slice(0, 2),
      achievements: game.totalAchievements,
      medianMinutes: times.get(game.id)?.median ?? null,
    });
  }
  return clues;
}

/** Le dossier de chaque édition, pour charger sa carte animée et son manifeste. */
export async function editionAssets(editionIds: string[]) {
  const rows = await db.gameEdition.findMany({
    where: { id: { in: [...new Set(editionIds)] } },
    select: { id: true, assetPath: true },
  });
  return new Map(rows.map((row) => [row.id, row.assetPath]));
}

/** Une carte de la collection d'un joueur, prête à afficher. */
export interface CollectionCard {
  enabled: boolean;
  editionId: string;
  familyKey: string;
  kind: EditionKind;
  assetPath: string;
  /** La miniature des grilles : légère, contrairement à l'image fixe en grand. */
  thumbUrl: string | null;
  obtainedAt: Date;
  /** Part des collectionneurs qui possèdent aussi cette édition, entre 0 et 1. */
  ownerShare: number | null;
  game: { name: string; slug: string; headerUrl: string | null } | null;
}

/** Une page de collection : de la plus rare à la plus courante, puis de la plus récente. */
export const COLLECTION_PAGE = 48;

const RANK = Prisma.sql`CASE e.kind WHEN 'MYTHIQUE' THEN 2 WHEN 'VIVANTE' THEN 1 ELSE 0 END`;

/** Où reprendre la lecture : la dernière carte de la page précédente, encodée dans l'adresse. */
interface Cursor {
  rank: number;
  obtainedAt: string;
  editionId: string;
}
const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
export function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor;
    if (
      typeof cursor.rank === 'number' &&
      typeof cursor.editionId === 'string' &&
      !Number.isNaN(Date.parse(cursor.obtainedAt))
    ) {
      return cursor;
    }
  } catch {
    // Une adresse abîmée repart du début.
  }
  return null;
}

/** Les collectionneurs du site, pour donner la rareté réelle d'une carte. Recompté par minute. */
let collectorCache: { at: number; count: Promise<number> } | null = null;
function collectorCount() {
  if (!collectorCache || Date.now() - collectorCache.at > 60_000) {
    collectorCache = {
      at: Date.now(),
      count: db.user.count({ where: { boostersOpened: { gt: 0 } } }),
    };
  }
  return collectorCache.count;
}

/**
 * Les compteurs de la collection, calculés en base sans charger les cartes : celles possédées
 * par rareté, et celles qui restent à découvrir parmi tout ce qui sort des boosters.
 */
export async function collectionSummary(userId: string) {
  const [owned, missing] = await Promise.all([
    db.$queryRaw<{ kind: EditionKind; count: number }[]>`
      SELECT e.kind, count(*)::int AS count
      FROM "UserEdition" ue JOIN "GameEdition" e ON e.id = ue."editionId"
      WHERE ue."userId" = ${userId}
      GROUP BY e.kind`,
    db.$queryRaw<{ kind: EditionKind; count: number }[]>`
      SELECT e.kind, count(*)::int AS count
      FROM "GameEdition" e
      JOIN "CardFamily" f ON f."familyKey" = e."familyKey" AND f.enabled AND NOT e.retired
        AND EXISTS (SELECT 1 FROM "Game" g WHERE g."familyKey" = e."familyKey")
        AND NOT EXISTS (SELECT 1 FROM "Game" g WHERE g."familyKey" = e."familyKey" AND g."adultOnly")
      WHERE NOT EXISTS (
        SELECT 1 FROM "UserEdition" mine WHERE mine."userId" = ${userId} AND mine."editionId" = e.id
      )
      GROUP BY e.kind`,
  ]);
  const byKind = (rows: { kind: EditionKind; count: number }[]) =>
    Object.fromEntries(
      EDITIONS.map((kind) => [kind, rows.find((row) => row.kind === kind)?.count ?? 0]),
    ) as Record<EditionKind, number>;
  return { owned: byKind(owned), missing: byKind(missing) };
}

/**
 * Une page de la collection, filtrée par rareté et par nom de jeu. La lecture reprend après la
 * dernière carte vue : une page coûte le même prix au début et au bout d'une grande collection.
 */
export async function collectionPage(
  userId: string,
  options: {
    kind?: EditionKind | null;
    search?: string;
    cursor?: Cursor | null;
    limit?: number;
  } = {},
) {
  const limit = options.limit ?? COLLECTION_PAGE;
  const search = options.search?.trim();
  const cursor = options.cursor;
  const rows = await db.$queryRaw<
    {
      editionId: string;
      obtainedAt: Date;
      familyKey: string;
      kind: EditionKind;
      assetPath: string;
      ownerCount: number;
      enabled: boolean;
      rank: number;
    }[]
  >`
    SELECT ue."editionId", ue."obtainedAt", e."familyKey", e.kind, e."assetPath", e."ownerCount",
      f.enabled, ${RANK} AS rank
    FROM "UserEdition" ue
    JOIN "GameEdition" e ON e.id = ue."editionId"
    JOIN "CardFamily" f ON f."familyKey" = e."familyKey"
    WHERE ue."userId" = ${userId}
      ${options.kind ? Prisma.sql`AND e.kind = ${options.kind}::"EditionKind"` : Prisma.empty}
      ${
        search
          ? Prisma.sql`AND EXISTS (
              SELECT 1 FROM "Game" g WHERE g."familyKey" = e."familyKey" AND g.name ILIKE ${`%${search}%`}
            )`
          : Prisma.empty
      }
      ${
        cursor
          ? Prisma.sql`AND (${RANK}, ue."obtainedAt", ue."editionId")
              < (${cursor.rank}, ${new Date(cursor.obtainedAt)}, ${cursor.editionId})`
          : Prisma.empty
      }
    ORDER BY rank DESC, ue."obtainedAt" DESC, ue."editionId" DESC
    LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const [art, collectors] = await Promise.all([
    familyArt(page.map((row) => row.familyKey)),
    collectorCount(),
  ]);
  const cards: CollectionCard[] = page.map((row) => ({
    enabled: row.enabled,
    editionId: row.editionId,
    familyKey: row.familyKey,
    kind: row.kind,
    assetPath: row.assetPath,
    thumbUrl: editionThumb(row.assetPath, art.get(row.familyKey)?.headerUrl ?? null),
    obtainedAt: row.obtainedAt,
    ownerShare: collectors ? Math.min(1, row.ownerCount / collectors) : null,
    game: withEditionStill(art.get(row.familyKey), row.assetPath),
  }));
  const last = page.at(-1);
  return {
    cards,
    next:
      rows.length > limit && last
        ? encodeCursor({
            rank: last.rank,
            obtainedAt: last.obtainedAt.toISOString(),
            editionId: last.editionId,
          })
        : null,
  };
}
