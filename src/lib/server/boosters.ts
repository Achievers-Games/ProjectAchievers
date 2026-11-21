import { randomInt, randomUUID } from 'node:crypto';
import type { BoosterSource, EditionKind } from '#prisma';
import { withEditionStill } from '#lib/animated-card';
import {
  BOOSTER_PRICE,
  canDraw,
  dailyStock,
  drawBooster,
  DUPLICATE_SHARDS,
  EDITIONS,
  normalKind,
  type Pool,
} from '#lib/boosters';
import { GENRES } from '#lib/site-achievements';
import { completionTimes } from './completion-time';
import { db } from './db';
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

/** Un nombre dans [0, 1[, tiré par le serveur : le navigateur n'a aucune prise sur le tirage. */
const secureRandom = () => randomInt(0, 2 ** 47) / 2 ** 47;

/**
 * Les éditions que ce joueur peut tirer : celles des jeux de sa bibliothèque où il a au moins un
 * succès, hors jeux cachés et jeux réservés aux adultes. L'avancement retenu est le meilleur de
 * ses versions du jeu.
 */
export async function editionPool(tx: Tx | typeof db, userId: string): Promise<Pool> {
  const rows = await tx.$queryRaw<
    { editionId: string; familyKey: string; kind: EditionKind; completion: number }[]
  >`
    SELECT e.id AS "editionId", e."familyKey", e.kind, max(ug.completion)::float AS completion
    FROM "GameEdition" e
    JOIN "CardFamily" f ON f."familyKey" = e."familyKey" AND f.enabled
    JOIN "Game" g ON g."familyKey" = e."familyKey" AND NOT g."adultOnly"
    JOIN "UserGame" ug ON ug."gameId" = g.id AND ug."userId" = ${userId}
      AND NOT ug.hidden AND ug."unlockedCount" > 0
    GROUP BY e.id`;
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
    editionPool(db, userId),
    playtimeHidden(db, userId),
  ]);
  return {
    playtimeHidden: hidden,
    shards: user.shards,
    daily: dailyStock(user.dailyBoosters, user.dailyAt),
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
    const pool = await editionPool(tx, userId);
    if (!canDraw(pool)) throw new BoosterError('no_cards');

    const id = randomUUID();
    const now = new Date();
    let daily = dailyStock(user.dailyBoosters, user.dailyAt, now);
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

    await tx.userEdition.createMany({
      data: cards
        .filter((card) => !card.duplicate)
        .map((card) => ({ userId, editionId: card.editionId })),
      skipDuplicates: true,
    });
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
  obtainedAt: Date;
  game: { name: string; slug: string; headerUrl: string | null } | null;
}

const RARITY: Record<EditionKind, number> = { RELIEF: 0, VIVANTE: 1, MYTHIQUE: 2 };

/**
 * La collection du joueur : ses cartes, de la plus rare à la plus courante puis de la plus
 * récente à la plus ancienne, et combien il en reste à découvrir parmi celles qu'il peut tirer.
 * Une carte possédée compte toujours, même si son jeu a quitté le tirage depuis.
 */
export async function userCollection(userId: string) {
  const [owned, pool] = await Promise.all([
    db.userEdition.findMany({
      where: { userId },
      select: {
        obtainedAt: true,
        edition: {
          select: {
            id: true,
            familyKey: true,
            kind: true,
            assetPath: true,
            family: { select: { enabled: true } },
          },
        },
      },
    }),
    editionPool(db, userId),
  ]);
  const art = await familyArt(owned.map((row) => row.edition.familyKey));
  const cards: CollectionCard[] = owned
    .map(({ obtainedAt, edition }) => ({
      enabled: edition.family.enabled,
      editionId: edition.id,
      familyKey: edition.familyKey,
      kind: edition.kind,
      assetPath: edition.assetPath,
      obtainedAt,
      game: withEditionStill(art.get(edition.familyKey), edition.assetPath),
    }))
    .sort(
      (a, b) => RARITY[b.kind] - RARITY[a.kind] || b.obtainedAt.getTime() - a.obtainedAt.getTime(),
    );
  const ownedIds = new Set(cards.map((card) => card.editionId));
  const missing = Object.fromEntries(
    EDITIONS.map((kind) => [kind, pool[kind].filter((row) => !ownedIds.has(row.editionId)).length]),
  ) as Record<EditionKind, number>;
  return { cards, missing };
}
