import { fail, redirect } from '@sveltejs/kit';
import { m } from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { localizeAchievements } from '$lib/server/achievement-texts';
import { db } from '$lib/server/db';
import { MAX_PINNED, pinnedAchievements } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

const RESULTS = 40;

function requireUser(locals: App.Locals) {
  if (!locals.user) redirect(303, '/connexion?retour=/compte/vitrine');
  return locals.user;
}

const achievementSelect = {
  id: true,
  name: true,
  iconUrl: true,
  globalRarity: true,
  game: { select: { name: true } },
};

export const load: PageServerLoad = async ({ locals, url }) => {
  const user = requireUser(locals);
  const q = url.searchParams.get('q')?.trim().slice(0, 80) || '';
  const locale = getLocale();

  const pinned = await pinnedAchievements(user.id);
  const unlocked = await db.userAchievement.findMany({
    where: {
      userId: user.id,
      achievementId: { notIn: pinned.map((a) => a.id) },
      ...(q && {
        achievement: {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { game: { name: { contains: q, mode: 'insensitive' } } },
          ],
        },
      }),
    },
    orderBy: { achievement: { globalRarity: { sort: 'asc', nulls: 'last' } } },
    take: RESULTS,
    select: { achievement: { select: achievementSelect } },
  });

  return {
    q,
    max: MAX_PINNED,
    pinned: await localizeAchievements(pinned, locale),
    results: await localizeAchievements(
      unlocked.map((row) => row.achievement),
      locale,
    ),
  };
};

export const actions: Actions = {
  add: async ({ request, locals }) => {
    const user = requireUser(locals);
    const achievementId = String((await request.formData()).get('id'));

    const unlocked = await db.userAchievement.count({ where: { userId: user.id, achievementId } });
    if (!unlocked) return fail(403, { error: m.showcase_not_unlocked() });

    const pinned = await db.pinnedAchievement.findMany({
      where: { userId: user.id },
      select: { position: true },
    });
    if (pinned.length >= MAX_PINNED) {
      return fail(409, { error: m.showcase_full({ max: MAX_PINNED }) });
    }

    const position = Math.max(-1, ...pinned.map((row) => row.position)) + 1;
    await db.pinnedAchievement.createMany({
      data: [{ userId: user.id, achievementId, position }],
      skipDuplicates: true,
    });
  },

  remove: async ({ request, locals }) => {
    const user = requireUser(locals);
    const achievementId = String((await request.formData()).get('id'));
    await db.pinnedAchievement.deleteMany({ where: { userId: user.id, achievementId } });
  },

  move: async ({ request, locals }) => {
    const user = requireUser(locals);
    const form = await request.formData();
    const pinned = await db.pinnedAchievement.findMany({
      where: { userId: user.id },
      orderBy: { position: 'asc' },
    });

    const index = pinned.findIndex((row) => row.achievementId === form.get('id'));
    const other = pinned[index + (form.get('direction') === 'up' ? -1 : 1)];
    const current = pinned[index];
    if (!current || !other) return;

    // Les deux lignes échangent leur place d'un seul coup.
    await db.$transaction([
      db.pinnedAchievement.update({
        where: { userId_achievementId: { userId: user.id, achievementId: current.achievementId } },
        data: { position: other.position },
      }),
      db.pinnedAchievement.update({
        where: { userId_achievementId: { userId: user.id, achievementId: other.achievementId } },
        data: { position: current.position },
      }),
    ]);
  },
};
