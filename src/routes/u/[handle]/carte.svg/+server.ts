import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db';
import { inlineAvatar, renderPlayerCard } from '#lib/server/player-card';
import { userStats } from '#lib/server/queries/stats';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** Assez frais pour suivre une séance de chasse, assez long pour ménager la base. */
const MAX_AGE = 30 * 60;

export const GET: RequestHandler = async ({ params }) => {
  const user = await db.user.findUnique({
    where: { handle: params.handle },
    select: {
      id: true,
      handle: true,
      displayName: true,
      avatarUrl: true,
      isPublic: true,
      clanMember: { select: { clan: { select: { name: true } } } },
    },
  });
  // Un profil privé ne se montre pas plus ailleurs que sur le site.
  if (!user?.isPublic) error(404, m.profile_not_found());

  const [stats, avatar] = await Promise.all([userStats(user.id), inlineAvatar(user.avatarUrl)]);
  const svg = renderPlayerCard({
    displayName: user.displayName,
    handle: user.handle,
    clan: user.clanMember?.clan.name ?? null,
    games: stats.games,
    unlocked: stats.unlocked,
    cards: stats.tiers.reduce((sum, count) => sum + count, 0),
    points: stats.points,
    avatar,
  });

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${MAX_AGE}`,
      // Ouverte seule, l'image ne doit rien pouvoir exécuter ni charger.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      // D'autres sites l'affichent : c'est tout l'intérêt.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
};
