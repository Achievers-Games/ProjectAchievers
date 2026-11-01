import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { PageServerLoad } from './$types';

/** Planche de tous les niveaux et exemplaires. N'existe qu'avec `vite dev`. */
export const load: PageServerLoad = () => {
  if (!dev) error(404, 'Page introuvable');
};
