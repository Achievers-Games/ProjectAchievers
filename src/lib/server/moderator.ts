import { error } from '@sveltejs/kit';
import { m } from '#lib/paraglide/messages';

/** Les pages de modération n'existent pas pour un simple membre. */
export function requireModerator(locals: App.Locals) {
  if (!locals.user || locals.user.role === 'USER') error(404, m.not_found());
  return locals.user;
}
