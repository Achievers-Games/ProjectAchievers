import { redirect } from '@sveltejs/kit';
import { dev } from '$app/env';
import { env } from '#lib/server/env';
import { availableProviders, safeReturnTo } from '#lib/server/providers';
import type { PageServerLoad } from './$types';
import { m } from '#lib/paraglide/messages';

const ERRORS: Record<string, () => string> = {
  expire: m.signin_expired,
  annule: m.signin_cancelled,
  refuse: m.signin_refused,
  fournisseur: m.signin_provider_down,
  indisponible: m.signin_unavailable,
};

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, '/compte');
  return {
    providers: availableProviders(),
    retour: safeReturnTo(url.searchParams.get('retour'), '/'),
    error: ERRORS[url.searchParams.get('erreur') ?? '']?.() ?? null,
    devLogin: dev && env().DEV_LOGIN === '1',
  };
};
