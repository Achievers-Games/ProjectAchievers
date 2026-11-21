import { error } from '@sveltejs/kit';
import { commentLimit } from '#lib/comments';
import { commentActions, loadComments } from '#lib/server/comments';
import { db } from '#lib/server/db';
import { env } from '#lib/server/env';
import { profileCardBanner } from '#lib/server/card-banner';
import { isCardsOpen } from '#lib/server/cards-launch';
import { userProfile } from '#lib/server/queries';
import { siteAchievementCount } from '#lib/server/site-achievements';
import { relationWith } from '#lib/server/social';
import { artNow } from '#lib/server/sync/content';
import { canTranslate } from '#lib/server/translate';
import type { Actions, PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals, depends, url }) => {
  depends('app:sync');
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  // Les jeux qui habillent ce profil et dont la capture n'est pas encore lue : demandée en
  // passant, sans faire attendre la page ; la prochaine visite l'aura.
  const dressing = [profile.showcase[0], profile.banner, profile.background].flatMap((game) =>
    game && 'slug' in game ? [game.slug] : [],
  );
  void artNow([], dressing).catch(() => 0);
  const relationPromise = locals.user ? relationWith(locals.user.id, profile.user.id) : null;
  const [relation, siteAchievements, cardBanner, comments] = await Promise.all([
    relationPromise,
    siteAchievementCount(profile.user.id),
    // Avant l'ouverture des boosters, aucune carte animée ne se montre sur un profil.
    isCardsOpen() ? profileCardBanner(profile.user.id) : null,
    (async () =>
      (await relationPromise) === 'blocked'
        ? null
        : loadComments({ profileId: profile.user.id }, locals.user, commentLimit(url)))(),
  ]);
  return {
    profile,
    relation,
    siteAchievements,
    cardBanner,
    comments,
    canTranslate: canTranslate(),
    origin: env().ORIGIN,
  };
};

export const actions: Actions = commentActions(async ({ params, locals }) => {
  const viewerId = locals.user?.id;
  const profile = await db.user.findFirst({
    where: {
      handle: params.handle,
      ...(viewerId
        ? {
            OR: [{ isPublic: true }, { id: viewerId }],
            blocks: { none: { blockedId: viewerId } },
            blockedBy: { none: { blockerId: viewerId } },
          }
        : { isPublic: true }),
    },
    select: { id: true },
  });
  return profile ? { profileId: profile.id } : null;
});
