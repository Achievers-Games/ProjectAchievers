import { db } from '#lib/server/db';
import { pushPublicKey } from '#lib/server/push';
import { themeOf } from '#lib/theme';
import { pendingInvites, unreadCount } from '#lib/server/social';
import { unseenNotices } from '#lib/server/notifications';
import { steamPrivacy } from '#lib/server/sync/steam';
import { steamReviewState } from '#lib/steam-review-state';
import type { LayoutServerLoad } from './$types';

const REVIEW_DAYS = 30;

/**
 * Les jeux dont la revue Steam touche aux points du joueur : en attente, bloqués, ou débloqués
 * récemment. La fenêtre d'information n'en montre que les changements qu'il n'a pas encore vus.
 */
async function playerSteamReviews(userId: string) {
  const since = new Date(Date.now() - REVIEW_DAYS * 86_400_000);
  const rows = await db.steamIntegrityReview.findMany({
    where: {
      userId,
      OR: [
        { status: { in: ['PENDING', 'REJECTED'] } },
        { suspendedAt: { not: null } },
        { status: 'APPROVED', reviewedAt: { gte: since }, openedAt: { gt: new Date(0) } },
      ],
    },
    orderBy: { openedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      status: true,
      suspendedAt: true,
      openedAt: true,
      reviewedAt: true,
      game: { select: { name: true, slug: true } },
    },
  });
  return rows.flatMap((row) => {
    const state = steamReviewState(row);
    if (!state) return [];
    // Change à chaque nouvel état : un jeu bloqué puis débloqué se signale deux fois.
    const changedAt = Math.max(
      row.openedAt.getTime(),
      row.reviewedAt?.getTime() ?? 0,
      row.suspendedAt?.getTime() ?? 0,
    );
    return [{ id: row.id, state, key: `${row.id}:${state}:${changedAt}`, game: row.game }];
  });
}

export const load: LayoutServerLoad = async ({ locals, cookies, depends }) => {
  depends('app:sync');
  depends('app:invites');
  depends('app:notices');
  const [unread, invites, unseen, steam, steamReviews] = locals.user
    ? await Promise.all([
        unreadCount(locals.user.id),
        pendingInvites(locals.user.id),
        unseenNotices(locals.user.id),
        // Steam cache des jeux à ce joueur : le site le lui dit, où qu'il soit.
        db.linkedAccount.findUnique({
          where: { userId_provider: { userId: locals.user.id, provider: 'STEAM' } },
          select: { playtimeHidden: true, syncError: true },
        }),
        playerSteamReviews(locals.user.id),
      ])
    : [0, { friends: 0, clans: 0 }, 0, null, []];
  return {
    unread,
    invites,
    notices: { unseen },
    steamPrivacy: steam && steamPrivacy(steam),
    steamReviews,
    pushKey: pushPublicKey(),
    user: locals.user && {
      id: locals.user.id,
      handle: locals.user.handle,
      displayName: locals.user.displayName,
      timeZone: locals.user.timeZone,
      avatarUrl: locals.user.avatarUrl,
      avatarMotionUrl: locals.user.avatarMotionUrl,
      frame: locals.user.frame,
      frameMotionUrl: locals.user.frameMotionUrl,
      role: locals.user.role,
      allowProfanity: locals.user.allowProfanity,
    },
    theme: themeOf(cookies.get('pa_theme')),
  };
};
