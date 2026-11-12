import { error, redirect } from '@sveltejs/kit';
import { resolveIdentity, type Identity } from '#lib/server/accounts';
import { saveMerge } from '#lib/server/merge';
import { OAUTH_PROVIDERS, takeFlow, type OAuthProvider } from '#lib/server/providers';
import { CODE_FLOWS } from '#lib/server/providers/flows';
import { fetchSteamIdentity, verifySteamResponse } from '#lib/server/providers/steam';
import { createSession } from '#lib/server/session';
import { logger } from '#lib/logger';
import { autoLinkLure, lureConfigured } from '#lib/server/partner-link';
import { enqueueSync } from '#lib/server/sync/queue';
import { recordAuthEvent, type AuthErrorReason } from '#lib/server/auth-events';
import type { RequestHandler } from './$types';
import { m } from '#lib/paraglide/messages';

const log = logger('Connexion');

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
  return CODE_FLOWS[provider].exchange(code, verifier);
}

export const GET: RequestHandler = async ({ params, url, cookies, locals, request }) => {
  const provider = params.provider as OAuthProvider;
  if (!(provider in OAUTH_PROVIDERS)) error(404, m.provider_unknown());

  /** Un échec est noté avec sa raison avant de renvoyer le visiteur à la connexion. */
  const fail = async (
    reason: AuthErrorReason,
    to = `/connexion?erreur=${reason}`,
  ): Promise<never> => {
    await recordAuthEvent(provider, 'ERROR', reason);
    redirect(303, to);
  };

  const flow = takeFlow(cookies, provider, url.searchParams.get('state'));
  if (!flow) return fail('expire');
  if (url.searchParams.has('error')) return fail('annule');

  let identity: Identity | null;
  try {
    identity = await identityFrom(provider, url.searchParams, flow.verifier);
  } catch (cause) {
    log.error(`Connexion ${provider} :`, cause);
    return fail('fournisseur');
  }
  if (!identity) return fail('refuse');

  const result = await resolveIdentity(identity, locals.user?.id ?? null);
  if (!result.ok) {
    if (result.reason === 'provider_taken')
      return fail('deja_lie', `/compte?erreur=${result.reason}`);
    saveMerge(cookies, {
      sourceId: result.ownerId,
      targetId: locals.user?.id ?? '',
      provider: identity.provider,
      providerUserId: identity.providerUserId,
    });
    redirect(303, '/compte');
  }

  if (!locals.user) await createSession(cookies, result.userId, request.headers.get('user-agent'));
  await recordAuthEvent(provider, result.created ? 'SIGNUP' : 'LOGIN');
  await enqueueSync(result.userId, identity.provider);

  // Le partenaire n'empêche jamais de se connecter : le délai est court et l'échec est muet.
  if (lureConfigured()) {
    try {
      await autoLinkLure(result.userId);
    } catch (cause) {
      log.warn('Liaison Lure :', cause);
    }
  }

  redirect(303, result.created ? '/compte?bienvenue=1' : flow.returnTo);
};
