import type { Reroute } from '@sveltejs/kit/hooks';
import { deLocalizeUrl } from '#lib/paraglide/runtime';

/**
 * `/en/jeux/…` et `/jeux/…` mènent à la même page : le préfixe ne choisit que la langue. Lu des
 * deux côtés, serveur et navigateur, avant de chercher la route.
 */
export const reroute: Reroute = ({ url }) => deLocalizeUrl(url).pathname;
