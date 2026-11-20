import { error } from '@sveltejs/kit';
import { dev } from '$app/env';
import type { PageServerLoad } from './$types';

/** Rejoue l'ouverture d'un booster sans rien tirer ni dépenser. N'existe qu'avec `vite dev`. */
export const load: PageServerLoad = () => {
  if (!dev) error(404, 'Page introuvable');
};
