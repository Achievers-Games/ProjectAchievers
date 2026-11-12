import { m } from '#lib/paraglide/messages';
import { error, redirect } from '@sveltejs/kit';
import { randomToken } from '#lib/server/crypto';
import {
  availableProviders,
  OAUTH_PROVIDERS,
  safeReturnTo,
  saveFlow,
  type OAuthProvider,
} from '#lib/server/providers';
import { CODE_FLOWS } from '#lib/server/providers/flows';
import { steamAuthorizeUrl } from '#lib/server/providers/steam';
import { recordAuthEvent } from '#lib/server/auth-events';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, cookies }) => {
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) error(404, m.provider_unknown());
  if (!availableProviders()[OAUTH_PROVIDERS[provider]]) {
    redirect(303, '/connexion?erreur=indisponible');
  }

  const state = randomToken();
  const verifier = provider === 'steam' ? undefined : randomToken(48);
  saveFlow(cookies, {
    provider,
    state,
    verifier,
    returnTo: safeReturnTo(url.searchParams.get('retour')),
  });

  await recordAuthEvent(provider, 'START');

  // Le fournisseur d'identité est un autre site : SvelteKit 3 exige de le dire explicitement.
  const external = { external: true };
  if (provider === 'steam') redirect(303, steamAuthorizeUrl(state), external);
  redirect(303, CODE_FLOWS[provider].authorizeUrl(state, verifier as string), external);
};
