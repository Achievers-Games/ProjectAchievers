import { error, redirect } from '@sveltejs/kit';
import { randomToken } from '$lib/server/crypto';
import {
  availableProviders,
  OAUTH_PROVIDERS,
  safeReturnTo,
  saveFlow,
  type OAuthProvider,
} from '$lib/server/providers';
import { discordAuthorizeUrl } from '$lib/server/providers/discord';
import { googleAuthorizeUrl } from '$lib/server/providers/google';
import { steamAuthorizeUrl } from '$lib/server/providers/steam';
import { xboxAuthorizeUrl } from '$lib/server/providers/xbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, url, cookies }) => {
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) error(404, 'Fournisseur inconnu');
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

  if (provider === 'steam') redirect(303, steamAuthorizeUrl(state));
  if (provider === 'discord') redirect(303, discordAuthorizeUrl(state, verifier as string));
  if (provider === 'google') redirect(303, googleAuthorizeUrl(state, verifier as string));
  redirect(303, xboxAuthorizeUrl(state, verifier as string));
};
