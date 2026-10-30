import { error, redirect } from '@sveltejs/kit';
import { resolveIdentity, type Identity } from '$lib/server/accounts';
import { OAUTH_PROVIDERS, takeFlow, type OAuthProvider } from '$lib/server/providers';
import { exchangeDiscordCode } from '$lib/server/providers/discord';
import { fetchSteamIdentity, verifySteamResponse } from '$lib/server/providers/steam';
import { exchangeXboxCode } from '$lib/server/providers/xbox';
import { createSession } from '$lib/server/session';
import { enqueueSync } from '$lib/server/sync/queue';
import type { RequestHandler } from './$types';

async function identityFrom(
  provider: OAuthProvider,
  query: URLSearchParams,
  verifier: string | undefined,
): Promise<Identity | null> {
  if (provider === 'steam') {
    const steamId = await verifySteamResponse(query);
    return steamId ? fetchSteamIdentity(steamId) : null;
  }
  const code = query.get('code');
  if (!code || !verifier) return null;
  return provider === 'discord'
    ? exchangeDiscordCode(code, verifier)
    : exchangeXboxCode(code, verifier);
}

export const GET: RequestHandler = async ({ params, url, cookies, locals, request }) => {
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) error(404, 'Fournisseur inconnu');

  const flow = takeFlow(cookies, provider, url.searchParams.get('state'));
  if (!flow) redirect(303, '/connexion?erreur=expire');
  if (url.searchParams.has('error')) redirect(303, '/connexion?erreur=annule');

  let identity: Identity | null;
  try {
    identity = await identityFrom(provider, url.searchParams, flow.verifier);
  } catch (cause) {
    console.error(`Connexion ${provider} :`, cause);
    redirect(303, '/connexion?erreur=fournisseur');
  }
  if (!identity) redirect(303, '/connexion?erreur=refuse');

  const result = await resolveIdentity(identity, locals.user?.id ?? null);
  if (!result.ok) redirect(303, `/compte?erreur=${result.reason}`);

  if (!locals.user) await createSession(cookies, result.userId, request.headers.get('user-agent'));
  await enqueueSync(result.userId, identity.provider);

  redirect(303, result.created ? '/compte?bienvenue=1' : flow.returnTo);
};
