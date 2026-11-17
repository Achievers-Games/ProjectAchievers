import { fail } from '@sveltejs/kit';
import { Prisma } from '#prisma';
import { db } from '#lib/server/db';
import { moveGameFamilies } from '#lib/server/card-rarity';
import { requireModerator } from '#lib/server/moderator';
import { m } from '#lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const PER_PAGE = 50;

/** Les jeux d'une famille, tels que la modération les juge. */
const gameSelect = {
  id: true,
  name: true,
  slug: true,
  platform: true,
  coverUrl: true,
  totalAchievements: true,
  familyKey: true,
  familyLocked: true,
  familyMatched: true,
} satisfies Prisma.GameSelect;

/**
 * Les familles de plusieurs jeux. « À vérifier » : au moins un jeu y a été rangé par la
 * synchronisation (titre ou liste de succès) ; « validées » : la modération a tout verrouillé.
 */
function familyFilter(validated: boolean, search: string) {
  return Prisma.sql`
    FROM "Game"
    WHERE "familyKey" IS NOT NULL
    GROUP BY "familyKey"
    HAVING count(*) > 1
      AND bool_and("familyLocked") = ${validated}
      ${search ? Prisma.sql`AND bool_or(name ILIKE ${`%${search}%`})` : Prisma.empty}`;
}

async function familyCount(validated: boolean, search: string) {
  const [row] = await db.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM (SELECT 1 ${familyFilter(validated, search)}) AS f`;
  return row?.count ?? 0;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  requireModerator(locals);
  const validated = url.searchParams.get('vue') === 'validees';
  const search = url.searchParams.get('q')?.trim().slice(0, 80) ?? '';
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

  const [pending, done, keys] = await Promise.all([
    familyCount(false, search),
    familyCount(true, search),
    db.$queryRaw<{ familyKey: string }[]>`
      SELECT "familyKey" ${familyFilter(validated, search)}
      ORDER BY "familyKey"
      LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`,
  ]);
  const games = await db.game.findMany({
    where: { familyKey: { in: keys.map((row) => row.familyKey) } },
    orderBy: [{ platform: 'asc' }, { name: 'asc' }],
    select: gameSelect,
  });

  return {
    validated,
    search,
    page,
    pages: Math.max(1, Math.ceil((validated ? done : pending) / PER_PAGE)),
    counts: { pending, done },
    families: keys.map(({ familyKey }) => {
      const members = games.filter((game) => game.familyKey === familyKey);
      return {
        key: familyKey,
        // Une liste de succès identique est un signal plus sûr qu'un titre proche.
        reason: members.some((game) => game.familyMatched) ? ('list' as const) : ('title' as const),
        games: members,
      };
    }),
  };
};

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export const actions: Actions = {
  /** La famille est juste : la synchronisation n'y touchera plus. */
  confirm: async ({ request, locals }) => {
    requireModerator(locals);
    const familyKey = field(await request.formData(), 'family');
    if (familyKey) await db.game.updateMany({ where: { familyKey }, data: { familyLocked: true } });
  },

  separate: async ({ request, locals }) => {
    requireModerator(locals);
    const id = field(await request.formData(), 'id');
    await moveGameFamilies([id], { familyKey: `seul-${id}`, familyLocked: true });
  },

  /** Range un jeu dans une famille existante, ou réunit deux jeux encore seuls. */
  join: async ({ request, locals }) => {
    requireModerator(locals);
    const form = await request.formData();
    const [first, second] = await Promise.all(
      ['first', 'second'].map((name) =>
        db.game.findUnique({ where: { id: field(form, name) }, select: gameSelect }),
      ),
    );
    if (!first || !second || first.id === second.id)
      return fail(404, { error: m.mod_game_missing() });

    const familyKey = first.familyKey ?? first.id;
    await moveGameFamilies([first.id, second.id], { familyKey, familyLocked: true });
  },
};
