import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import { steamReviewState } from '#lib/steam-review-state';
import type { PageServerLoad } from './$types';

/**
 * Les jeux Steam du joueur que l'anti-triche a examinés, rangés par état : bloqués, en attente de
 * validation, validés. Le joueur y voit ce qui compte dans ses points et comment débloquer le reste.
 */
export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('app:sync');
  const user = requireLogin(locals, '/compte/verification-steam');
  const rows = await db.steamIntegrityReview.findMany({
    where: { userId: user.id },
    orderBy: { openedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      status: true,
      suspendedAt: true,
      openedAt: true,
      reviewedAt: true,
      proofAt: true,
      game: { select: { name: true, slug: true, crossProgress: true } },
    },
  });
  const games = rows.flatMap((row) => {
    const state = steamReviewState(row);
    if (!state) return [];
    return [
      {
        id: row.id,
        state,
        game: row.game,
        since: row.suspendedAt ?? (state === 'unblocked' ? row.reviewedAt : null) ?? row.openedAt,
        proofAt: row.proofAt,
        // La preuve ne vaut que pour un lot en attente ; une décision de modérateur est définitive.
        canProve: row.status === 'PENDING',
        // Une remise à zéro ne sert à rien sur un jeu dont le serveur rend les succès.
        canReset: state === 'blocked' && !row.game.crossProgress,
      },
    ];
  });
  return { games };
};
