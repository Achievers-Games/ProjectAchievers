import { localizedPath } from '#lib/localized-path';

/** Une étape du fil d'Ariane : son nom et son chemin sans préfixe de langue (`/jeux/hades`). */
export interface Crumb {
  name: string;
  path: string;
}

/**
 * Le fil d'Ariane au format schema.org : Google l'affiche à la place de l'adresse dans ses
 * résultats (Jeux › Hades › Succès). Les adresses suivent la langue de la page, comme sa
 * canonique, pour que chaque version renvoie vers ses propres pages.
 */
export const breadcrumbList = (crumbs: Crumb[], origin: string, locale: string) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((crumb, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: crumb.name,
    item: new URL(localizedPath(crumb.path, locale), origin).href,
  })),
});
