import { error } from '@sveltejs/kit';
import { env } from '#lib/server/env';
import { profileCardBanner } from '#lib/server/card-banner';
import { isCardsOpen } from '#lib/server/cards-launch';
import { userProfile } from '#lib/server/queries';
import { siteAchievementCount } from '#lib/server/site-achievements';
import { relationWith } from '#lib/server/social';
import { artNow } from '#lib/server/sync/content';
import type { PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, locals, depends }) => {
  depends('app:sync');
  const profile = await userProfile(params.handle, locals.user?.id ?? null, locals.user?.showAdult);
  if (!profile) error(404, m.profile_not_found());
  // Les jeux qui habillent ce profil et dont la capture n'est pas encore lue : demandée en
  // passant, sans faire attendre la page ; la prochaine visite l'aura.
  const dressing = [profile.showcase[0], profile.banner, profile.background].flatMap((game) =>
    game && 'slug' in game ? [game.slug] : [],
  );
  void artNow([], dressing).catch(() => 0);
  // Deux lectures indépendantes : les mener de front épargne un aller-retour à la base.
  const [relation, siteAchievements, cardBanner] = await Promise.all([
    locals.user ? relationWith(locals.user.id, profile.user.id) : null,
    siteAchievementCount(profile.user.id),
    // Avant l'ouverture des boosters, aucune carte animée ne se montre sur un profil.
    isCardsOpen() ? profileCardBanner(profile.user.id) : null,
  ]);
  return { profile, relation, siteAchievements, cardBanner, origin: env().ORIGIN };
};
