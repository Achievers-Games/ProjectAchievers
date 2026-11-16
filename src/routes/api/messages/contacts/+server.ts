import { error, json } from '@sveltejs/kit';
import { friendList } from '#lib/server/social';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

/** Les amis à qui le joueur peut écrire : seuls des amis discutent entre eux. */
export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, m.login_required());
  const friends = await friendList(locals.user.id);
  return json(
    friends.map(({ id, handle, displayName, avatarUrl, frame }) => ({
      id,
      handle,
      displayName,
      avatarUrl,
      frame,
    })),
  );
};
