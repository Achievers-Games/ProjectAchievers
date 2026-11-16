import { baseLocale } from '#lib/paraglide/runtime';

/**
 * L'adresse qu'on donne aux moteurs pour une page dans une langue : `/en/…`, `/de/…`, sans barre
 * finale (`/en` pour l'accueil), et l'adresse sans préfixe pour le français. Google gardait déjà
 * celle-ci, et tous les liens du site y mènent : déclarer `/fr/…` le contredisait, et chaque page
 * finissait « en double ». `/fr/…` reste servie et désigne cette adresse comme canonique.
 *
 * Construite à la main : le plan du site en demande des milliers, et le motif générique de
 * Paraglide les rendait trop lents (plus de 20 secondes sur le NAS).
 */
export const localizedPath = (path: string, locale: string) =>
  locale === baseLocale ? path : `/${locale}${path === '/' ? '' : path}`;
