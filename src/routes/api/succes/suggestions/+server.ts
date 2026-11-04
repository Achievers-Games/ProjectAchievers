import { error, json } from '@sveltejs/kit';
import { SITE_CODES } from '#lib/site-achievements';
import { siteSuggestions } from '#lib/server/site-achievements';
import { m } from '#lib/paraglide/messages';
import type { RequestHandler } from './$types';

/** Les jeux à lancer pour décrocher un succès du site : ceux du joueur d'abord. */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, m.login_required());
  const code = url.searchParams.get('code') ?? '';
  if (!(SITE_CODES as string[]).includes(code)) error(404, m.not_found());
  return json(await siteSuggestions(locals.user.id, code, locals.user.showAdult));
};
