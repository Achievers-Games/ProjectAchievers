import { redirect } from '@sveltejs/kit';

/** Renvoie vers la connexion, puis ramène le visiteur à la page demandée. */
export function requireLogin(locals: App.Locals, returnTo: string) {
  if (!locals.user) redirect(303, `/connexion?retour=${encodeURIComponent(returnTo)}`);
  return locals.user;
}
