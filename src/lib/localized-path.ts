/**
 * L'adresse d'une page dans une langue : `/fr/…`, `/en/…`, sans barre finale (`/en` pour
 * l'accueil). C'est la forme que donne `localizeUrl` avec la configuration du site, construite
 * à la main : le plan du site en demande des milliers, et le motif générique de Paraglide les
 * rendait trop lents (plus de 20 secondes sur le NAS).
 */
export const localizedPath = (path: string, locale: string) =>
  `/${locale}${path === '/' ? '' : path}`;
