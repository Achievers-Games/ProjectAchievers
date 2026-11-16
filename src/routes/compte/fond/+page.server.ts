import { fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { onePerFamily, toBanner } from '#lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/** Assez pour choisir sans charger toute une bibliothèque Steam : la recherche fait le reste. */
const SHOWN = 48;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/compte/fond');

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const q = url.searchParams.get('q')?.trim().slice(0, 80) || '';

  const [profile, rows] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { handle: true, backgroundOff: true, backgroundGameId: true },
    }),
    db.userGame.findMany({
      where: {
        userId: user.id,
        hidden: false,
        game: {
          headerUrl: { not: null },
          ...(q && { name: { contains: q, mode: 'insensitive' } }),
        },
      },
      orderBy: [{ lastPlayedAt: { sort: 'desc', nulls: 'last' } }, { game: { name: 'asc' } }],
      // Un jeu possédé sur plusieurs plateformes revient plusieurs fois : on en lit plus, puis on
      // ne garde qu'une version par famille.
      take: SHOWN * 3,
      select: {
        game: {
          select: {
            id: true,
            name: true,
            slug: true,
            headerUrl: true,
            platform: true,
            familyKey: true,
          },
        },
      },
    }),
  ]);
  const mode = profile.backgroundOff ? 'off' : profile.backgroundGameId ? 'game' : 'auto';
  return {
    q,
    handle: profile.handle,
    mode,
    chosen: profile.backgroundGameId,
    games: onePerFamily(
      rows.map((row) => row.game),
      profile.backgroundGameId,
    )
      .slice(0, SHOWN)
      .map((game) => ({
        id: game.id,
        ...toBanner({ ...game, headerUrl: game.headerUrl as string }),
      })),
  };
};

export const actions: Actions = {
  /** Revient au premier jeu de la vitrine, ou retire le fond. */
  mode: async ({ request, locals }) => {
    const user = requireUser(locals);
    const off = (await request.formData()).get('mode') === 'off';
    await db.user.update({
      where: { id: user.id },
      data: { backgroundOff: off, backgroundGameId: null },
    });
    return { success: m.background_saved() };
  },

  choose: async ({ request, locals }) => {
    const user = requireUser(locals);
    const gameId = String((await request.formData()).get('game') ?? '');
    const owned = await db.userGame.findFirst({
      where: { userId: user.id, gameId, hidden: false, game: { headerUrl: { not: null } } },
      select: { gameId: true },
    });
    if (!owned) return fail(403, { error: m.showcase_not_owned() });
    await db.user.update({
      where: { id: user.id },
      data: { backgroundOff: false, backgroundGameId: gameId },
    });
    return { success: m.background_saved() };
  },
};
