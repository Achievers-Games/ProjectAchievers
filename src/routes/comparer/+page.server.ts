import { error } from '@sveltejs/kit';
import { compareUsers, userStats } from '$lib/server/queries';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
  const [a, b] = [url.searchParams.get('a'), url.searchParams.get('b')];
  if (!a || !b) error(404, 'Choisis deux profils à comparer.');

  const users = await db.user.findMany({
    where: {
      handle: { in: [a, b] },
      OR: [{ isPublic: true }, { id: locals.user?.id ?? '' }],
    },
    select: { id: true, handle: true, displayName: true, avatarUrl: true },
  });
  const left = users.find((u) => u.handle === a);
  const right = users.find((u) => u.handle === b);
  if (!left || !right) error(404, 'Un de ces profils est introuvable ou privé.');

  const [games, leftStats, rightStats] = await Promise.all([
    compareUsers(left.id, right.id, locals.user?.showAdult),
    userStats(left.id),
    userStats(right.id),
  ]);

  return { left, right, games, leftStats, rightStats };
};
