import { fail } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { fetchSteamLook } from '#lib/server/providers/steam';
import { onePerFamily, toBanner } from '#lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/** Assez pour choisir sans charger toute une bibliothèque Steam : la recherche fait le reste. */
const SHOWN = 48;

const requireUser = (locals: App.Locals) => requireLogin(locals, '/compte/fond');

/**
 * Le fond équipé sur Steam, relu à l'ouverture de la page : le joueur vient peut-être d'en
 * changer. Si Steam ne répond pas, le dernier connu reste valable.
 */
async function steamBackground(userId: string) {
  const account = await db.linkedAccount.findUnique({
    where: { userId_provider: { userId, provider: 'STEAM' } },
    select: { id: true, providerUserId: true, backgroundUrl: true, backgroundMotionUrl: true },
  });
  if (!account) return null;
  const look = await fetchSteamLook(account.providerUserId);
  const url = look ? (look.backgroundUrl ?? null) : account.backgroundUrl;
  const motion = look ? (look.backgroundMotionUrl ?? null) : account.backgroundMotionUrl;
  if (url !== account.backgroundUrl || motion !== account.backgroundMotionUrl) {
    await db.linkedAccount.update({
      where: { id: account.id },
      data: { backgroundUrl: url, backgroundMotionUrl: motion },
    });
  }
  return { url, motion };
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const q = url.searchParams.get('q')?.trim().slice(0, 80) || '';

  const [profile, steam, rows] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { handle: true, backgroundOff: true, backgroundSteam: true, backgroundGameId: true },
    }),
    steamBackground(user.id),
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
  const mode = profile.backgroundOff
    ? 'off'
    : profile.backgroundSteam
      ? 'steam'
      : profile.backgroundGameId
        ? 'game'
        : 'auto';
  return {
    q,
    handle: profile.handle,
    mode,
    chosen: profile.backgroundGameId,
    steam,
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
  /** Le fond du profil Steam, le premier jeu de la vitrine, ou aucun fond. */
  mode: async ({ request, locals }) => {
    const user = requireUser(locals);
    const mode = (await request.formData()).get('mode');
    if (mode === 'steam') {
      // Le jeu choisi reste en réserve : il revient si le joueur retire son fond sur Steam.
      await db.user.update({
        where: { id: user.id },
        data: { backgroundSteam: true, backgroundOff: false },
      });
    } else {
      await db.user.update({
        where: { id: user.id },
        data: { backgroundOff: mode === 'off', backgroundSteam: false, backgroundGameId: null },
      });
    }
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
      data: { backgroundOff: false, backgroundSteam: false, backgroundGameId: gameId },
    });
    return { success: m.background_saved() };
  },
};
