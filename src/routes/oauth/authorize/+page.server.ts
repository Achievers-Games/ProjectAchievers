import { error, redirect } from '@sveltejs/kit';
import { requireLogin } from '#lib/server/auth';
import { db } from '#lib/server/db';
import {
  approveAuthorization,
  denyAuthorization,
  readAuthorizeRequest,
  type AuthorizeRequest,
} from '#lib/server/oauth-provider';
import { m } from '#lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

/**
 * Le retour se fait chez le partenaire, sur une adresse qu'il a enregistrée et que
 * `readAuthorizeRequest` a vérifiée : SvelteKit 3 veut qu'une redirection externe soit voulue.
 */
function toPartner(location: string): never {
  redirect(303, location, { external: true });
}

/**
 * Lit la demande du partenaire. Un client inconnu ou une adresse de retour douteuse s'arrêtent
 * ici, sans jamais rediriger ; toute autre erreur repart chez le partenaire.
 */
async function readRequest(search: string): Promise<AuthorizeRequest> {
  const read = await readAuthorizeRequest(new URLSearchParams(search));
  if (read.ok) return read.request;
  if (read.fatal) error(400, m.oauth_invalid_request());
  return toPartner(read.redirect);
}

export const load: PageServerLoad = async ({ url, locals }) => {
  const request = await readRequest(url.search);
  const user = requireLogin(locals, `${url.pathname}${url.search}`);

  // Déjà accordé avec les mêmes portées : « Se connecter avec Achievers » passe sans redemander.
  const grant = await db.oAuthGrant.findUnique({
    where: { userId_appId: { userId: user.id, appId: request.app.id } },
    select: { scopes: true, revokedAt: true },
  });
  if (grant && !grant.revokedAt && request.scopes.every((scope) => grant.scopes.includes(scope))) {
    toPartner(await approveAuthorization(user.id, request));
  }

  return { app: request.app.name, scopes: request.scopes, query: url.search };
};

export const actions: Actions = {
  // Le formulaire renvoie la demande telle quelle : elle est relue et revérifiée, jamais crue.
  approve: async ({ request, locals, url }) => {
    const user = requireLogin(locals, `${url.pathname}${url.search}`);
    const search = String((await request.formData()).get('query') ?? '');
    toPartner(await approveAuthorization(user.id, await readRequest(search)));
  },
  deny: async ({ request, locals, url }) => {
    requireLogin(locals, `${url.pathname}${url.search}`);
    const search = String((await request.formData()).get('query') ?? '');
    toPartner(denyAuthorization(await readRequest(search)));
  },
};
