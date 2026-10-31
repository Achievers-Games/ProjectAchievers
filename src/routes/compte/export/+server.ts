import { error, json } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

/** Export RGPD : tout ce qui concerne l'utilisateur, sans les jetons chiffrés. */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());

  const data = await db.user.findUniqueOrThrow({
    where: { id: locals.user.id },
    select: {
      handle: true,
      displayName: true,
      avatarUrl: true,
      isPublic: true,
      showAdult: true,
      createdAt: true,
      accounts: {
        select: {
          provider: true,
          providerUserId: true,
          displayName: true,
          linkedAt: true,
          lastSyncedAt: true,
        },
      },
      games: {
        select: { game: { select: { name: true } }, unlockedCount: true, completion: true },
      },
      achievements: {
        select: {
          unlockedAt: true,
          achievement: { select: { name: true, game: { select: { name: true } } } },
        },
      },
      guides: { select: { contentMd: true, createdAt: true } },
      comments: { select: { contentMd: true, createdAt: true } },
    },
  });

  return json(data, {
    headers: { 'Content-Disposition': 'attachment; filename="project-achievers.json"' },
  });
};
