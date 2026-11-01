import { error, redirect } from '@sveltejs/kit';
import { resolveIdentity, type Identity } from '$lib/server/accounts';
import { saveMerge } from '$lib/server/merge';
import { OAUTH_PROVIDERS, takeFlow, type OAuthProvider } from '$lib/server/providers';
import { exchangeDiscordCode } from '$lib/server/providers/discord';
import { exchangeBlizzardCode } from '$lib/server/providers/blizzard';
import { exchangeEpicCode } from '$lib/server/providers/epic';
import { exchangeGoogleCode } from '$lib/server/providers/google';
import { fetchSteamIdentity, verifySteamResponse } from '$lib/server/providers/steam';
import { exchangeXboxCode } from '$lib/server/providers/xbox';
import { createSession } from '$lib/server/session';
import { enqueueSync } from '$lib/server/sync/queue';
import type { RequestHandler } from './$types';
import { m } from '$lib/paraglide/messages';

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
  if (provider === 'epic') return exchangeEpicCode(code);
  if (provider === 'blizzard') return exchangeBlizzardCode(code);
  if (provider === 'discord') return exchangeDiscordCode(code, verifier);
  if (provider === 'google') return exchangeGoogleCode(code, verifier);
  return exchangeXboxCode(code, verifier);
}

export const GET: RequestHandler = async ({ params, url, cookies, locals, request }) => {
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) error(404, m.provider_unknown());

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
  if (!result.ok) {
    if (result.reason === 'provider_taken') redirect(303, `/compte?erreur=${result.reason}`);
    saveMerge(cookies, {
      sourceId: result.ownerId,
      targetId: locals.user?.id ?? '',
      provider: identity.provider,
      providerUserId: identity.providerUserId,
    });
    redirect(303, '/compte');
  }

  if (!locals.user) await createSession(cookies, result.userId, request.headers.get('user-agent'));
  await enqueueSync(result.userId, identity.provider);

  redirect(303, result.created ? '/compte?bienvenue=1' : flow.returnTo);
};
