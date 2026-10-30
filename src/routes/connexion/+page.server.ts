import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$lib/server/env';
import { availableProviders, safeReturnTo } from '$lib/server/providers';
import type { PageServerLoad } from './$types';

const ERRORS: Record<string, string> = {
  expire: 'La demande de connexion a expiré. Réessaie.',
  annule: 'Connexion annulée.',
  refuse: "Le fournisseur n'a pas confirmé ton identité.",
  fournisseur: 'Le fournisseur est injoignable pour le moment. Réessaie plus tard.',
  indisponible: "Ce mode de connexion n'est pas encore activé.",
};

export const load: PageServerLoad = ({ locals, url }) => {
  if (locals.user) redirect(303, '/compte');
  return {
    providers: availableProviders(),
    retour: safeReturnTo(url.searchParams.get('retour'), '/'),
    error: ERRORS[url.searchParams.get('erreur') ?? ''] ?? null,
    devLogin: dev && env().DEV_LOGIN === '1',
  };
};
