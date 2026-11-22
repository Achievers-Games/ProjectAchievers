import { Prisma, type EditionKind } from '#prisma';
import { EDITIONS } from '#lib/boosters';
import {
  CARD_CATALOGUE,
  CARD_DRAFTS,
  draftCardPaths,
  publishedCardPath,
} from '#lib/card-catalogue';
import artworkData from '#lib/card-artworks.json';
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
  /** L'adresse publiée de chaque carte déjà faite (brouillons compris), pour la voir animée. */
  editions: Partial<Record<EditionKind, string>> | null;
}

type PlanRow = Omit<CardPlanRow, 'editions'> & {
  catalogueAppId: string | null;
  draftAppId: string | null;
};

/** Les cartes publiées d'un jeu du catalogue, par rareté. */
function publishedEditions(appId: string | null) {
  const entry = appId ? CARD_CATALOGUE.find((game) => game.steamAppId === appId) : undefined;
  return entry
    ? (Object.fromEntries(EDITIONS.map((kind) => [kind, publishedCardPath(entry, kind)])) as Record<
        EditionKind,
        string
      >)
    : null;
}

/** Les cartes d'un brouillon, visibles en modération avant que le jeu ait ses trois raretés. */
function draftEditions(appId: string | null) {
  const entry = appId ? CARD_DRAFTS.find((game) => game.steamAppId === appId) : undefined;
  return entry ? draftCardPaths(entry) : null;
}

const draftAppIds = () => CARD_DRAFTS.map((game) => game.steamAppId);
const draftCounts = () => CARD_DRAFTS.map((game) => Object.keys(game.editions).length);
const catalogueAppIds = () => CARD_CATALOGUE.map((game) => game.steamAppId);

/**
 * Les artworks Mythique retenus, versionnés avec le site (`src/lib/card-artworks.json`, par
 * identifiant Steam) : on les choisit hors du site, et un commit suffit à les montrer.
 */
export const CARD_ARTWORKS: Readonly<Record<string, { name: string; url: string }>> =
  artworkData.artworks;
const artworkIds = () => Object.keys(CARD_ARTWORKS);
const artworkUrls = () => Object.values(CARD_ARTWORKS).map((artwork) => artwork.url);

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
      array_agg(g."platformGameId") FILTER (WHERE g.platform = 'STEAM') AS "steamAppIds",
      (array_agg(g."heroUrl" ORDER BY g.platform <> 'STEAM', coalesce(p.players, 0) DESC)
        FILTER (WHERE g."heroUrl" IS NOT NULL))[1] AS "heroUrl",
      bool_or(g.platform = 'STEAM' AND g."platformGameId" = ANY(${catalogueAppIds()}::text[])) AS made,
      (array_agg(g."platformGameId") FILTER (
        WHERE g.platform = 'STEAM' AND g."platformGameId" = ANY(${catalogueAppIds()}::text[])
      ))[1] AS "catalogueAppId",
      (array_agg(g."platformGameId" ORDER BY coalesce(p.players, 0) DESC) FILTER (
        WHERE g.platform = 'STEAM' AND g."platformGameId" = ANY(${draftAppIds()}::text[])
      ))[1] AS "draftAppId"
    FROM "Game" g
    LEFT JOIN played p ON p."gameId" = g.id
    WHERE g."familyKey" IS NOT NULL
    GROUP BY g."familyKey"
    HAVING NOT bool_or(g."adultOnly")
  ), plan AS (
    SELECT f."familyKey", f.name, f.slug, f.players, f."steamAppId", f."heroUrl", f.made,
      f."catalogueAppId", f."draftAppId", c.note,
      CASE WHEN f.made THEN 0 ELSE coalesce(
        (SELECT d.cards FROM unnest(${draftAppIds()}::text[], ${draftCounts()}::int[]) AS d(id, cards)
          WHERE d.id = f."draftAppId"), 0) END AS "draftCards",
      coalesce(
        c."mythiqueArtUrl",
        (SELECT a.url FROM unnest(${artworkIds()}::text[], ${artworkUrls()}::text[]) AS a(id, url)
          WHERE a.id = ANY(f."steamAppIds") LIMIT 1)
      ) AS "mythiqueArtUrl"
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
        draftCards: number;
      }[]
    >`${families()}
      SELECT count(*)::int AS games,
        count(*) FILTER (WHERE made)::int AS made,
        count(*) FILTER (WHERE NOT made AND "heroUrl" IS NOT NULL)::int AS heroes,
        count(*) FILTER (WHERE NOT made AND "mythiqueArtUrl" IS NOT NULL)::int AS artworks,
        coalesce(sum("draftCards"), 0)::int AS "draftCards"
      FROM plan`,
    db.$queryRaw<{ count: number }[]>`${families()}
      SELECT count(*)::int AS count FROM plan WHERE ${where}`,
    db.$queryRaw<PlanRow[]>`${families()}
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
      /** Trois cartes par jeu restant, moins celles des brouillons. */
      cardsLeft: remaining * 3 - (totals?.draftCards ?? 0),
      /** Relief et Vivante : jeux restants dont l'image Steam est déjà là. */
      heroes: totals?.heroes ?? 0,
      heroesMissing: remaining - (totals?.heroes ?? 0),
      /** Mythique : jeux restants dont l'artwork est déjà choisi. */
      artworks: totals?.artworks ?? 0,
      artworksMissing: remaining - (totals?.artworks ?? 0),
    },
    pages: Math.max(1, Math.ceil((matching?.count ?? 0) / CARD_PLAN_PER_PAGE)),
    rows: rows.map(({ catalogueAppId, draftAppId, ...row }): CardPlanRow => ({
      ...row,
      editions: publishedEditions(catalogueAppId) ?? draftEditions(draftAppId),
    })),
  };
}

/**
 * Note l'artwork officiel retenu pour la Mythique d'un jeu ; une adresse vide l'efface. Les
 * artworks se choisissent hors du site et s'enregistrent par script : la page ne fait que les
 * montrer.
 */
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
