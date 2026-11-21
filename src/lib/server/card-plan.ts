import { Prisma } from '#prisma';
import { CARD_CATALOGUE } from '#lib/card-catalogue';
import { db } from './db';

/**
 * Les cartes à créer : chaque jeu du site (une famille, toutes plateformes confondues) attend
 * trois cartes. Relief et Vivante partent de l'image de bibliothèque Steam (`heroUrl`), la Mythique
 * d'un artwork officiel noté dans `CardPlan`. Un jeu est fait quand il est au catalogue, toujours
 * avec ses trois raretés. Les jeux réservés aux adultes n'auront jamais de carte.
 */
export const CARD_PLAN_VIEWS = [
  'a-faire',
  'sans-hero',
  'sans-artwork',
  'faites',
  'toutes',
] as const;
export type CardPlanView = (typeof CARD_PLAN_VIEWS)[number];

export const CARD_PLAN_PER_PAGE = 50;

export interface CardPlanRow {
  familyKey: string;
  name: string;
  slug: string;
  players: number;
  steamAppId: string | null;
  heroUrl: string | null;
  made: boolean;
  mythiqueArtUrl: string | null;
  note: string | null;
}

const catalogueAppIds = () => CARD_CATALOGUE.map((game) => game.steamAppId);

/** Une ligne par famille de jeu, avec sa popularité, son image Steam et l'état de ses cartes. */
const families = () => Prisma.sql`
  WITH played AS (
    SELECT "gameId", count(*)::int AS players FROM "UserGame" GROUP BY "gameId"
  ), family AS (
    SELECT g."familyKey",
      (array_agg(g.name ORDER BY coalesce(p.players, 0) DESC, g."createdAt"))[1] AS name,
      (array_agg(g.slug ORDER BY coalesce(p.players, 0) DESC, g."createdAt"))[1] AS slug,
      coalesce(sum(p.players), 0)::int AS players,
      (array_agg(g."platformGameId" ORDER BY coalesce(p.players, 0) DESC)
        FILTER (WHERE g.platform = 'STEAM'))[1] AS "steamAppId",
      (array_agg(g."heroUrl" ORDER BY g.platform <> 'STEAM', coalesce(p.players, 0) DESC)
        FILTER (WHERE g."heroUrl" IS NOT NULL))[1] AS "heroUrl",
      bool_or(g.platform = 'STEAM' AND g."platformGameId" = ANY(${catalogueAppIds()}::text[])) AS made
    FROM "Game" g
    LEFT JOIN played p ON p."gameId" = g.id
    WHERE g."familyKey" IS NOT NULL
    GROUP BY g."familyKey"
    HAVING NOT bool_or(g."adultOnly")
  ), plan AS (
    SELECT f.*, c."mythiqueArtUrl", c.note
    FROM family f LEFT JOIN "CardPlan" c ON c."familyKey" = f."familyKey"
  )`;

function viewFilter(view: CardPlanView) {
  switch (view) {
    case 'a-faire':
      return Prisma.sql`NOT made`;
    case 'sans-hero':
      return Prisma.sql`NOT made AND "heroUrl" IS NULL`;
    case 'sans-artwork':
      return Prisma.sql`NOT made AND "mythiqueArtUrl" IS NULL`;
    case 'faites':
      return Prisma.sql`made`;
    case 'toutes':
      return Prisma.sql`true`;
  }
}

/**
 * Le décompte de tout le site et une page de jeux, les plus joués d'abord : ce sont les cartes
 * qui sortiront le plus souvent des boosters.
 */
export async function cardPlan(view: CardPlanView, search: string, page: number) {
  const where = Prisma.sql`${viewFilter(view)}
    ${search ? Prisma.sql`AND name ILIKE ${`%${search}%`}` : Prisma.empty}`;
  const [[totals], [matching], rows] = await Promise.all([
    db.$queryRaw<
      {
        games: number;
        made: number;
        heroes: number;
        artworks: number;
      }[]
    >`${families()}
      SELECT count(*)::int AS games,
        count(*) FILTER (WHERE made)::int AS made,
        count(*) FILTER (WHERE NOT made AND "heroUrl" IS NOT NULL)::int AS heroes,
        count(*) FILTER (WHERE NOT made AND "mythiqueArtUrl" IS NOT NULL)::int AS artworks
      FROM plan`,
    db.$queryRaw<{ count: number }[]>`${families()}
      SELECT count(*)::int AS count FROM plan WHERE ${where}`,
    db.$queryRaw<CardPlanRow[]>`${families()}
      SELECT * FROM plan WHERE ${where}
      ORDER BY players DESC, name ASC
      LIMIT ${CARD_PLAN_PER_PAGE} OFFSET ${(page - 1) * CARD_PLAN_PER_PAGE}`,
  ]);
  const games = totals?.games ?? 0;
  const made = totals?.made ?? 0;
  const remaining = games - made;
  return {
    totals: {
      games,
      made,
      /** Trois cartes par jeu restant. */
      cardsLeft: remaining * 3,
      /** Relief et Vivante : jeux restants dont l'image Steam est déjà là. */
      heroes: totals?.heroes ?? 0,
      heroesMissing: remaining - (totals?.heroes ?? 0),
      /** Mythique : jeux restants dont l'artwork est déjà choisi. */
      artworks: totals?.artworks ?? 0,
      artworksMissing: remaining - (totals?.artworks ?? 0),
    },
    pages: Math.max(1, Math.ceil((matching?.count ?? 0) / CARD_PLAN_PER_PAGE)),
    rows,
  };
}

/** Note l'artwork officiel retenu pour la Mythique d'un jeu ; une adresse vide l'efface. */
export async function saveCardPlan(
  familyKey: string,
  mythiqueArtUrl: string | null,
  note: string | null,
) {
  await db.cardPlan.upsert({
    where: { familyKey },
    create: { familyKey, mythiqueArtUrl, note },
    update: { mythiqueArtUrl, note },
  });
}
