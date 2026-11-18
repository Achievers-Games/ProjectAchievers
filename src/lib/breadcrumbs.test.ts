import { describe, expect, it } from 'vitest';
import { breadcrumbList } from './breadcrumbs';

const crumbs = [
  { name: 'Jeux', path: '/jeux' },
  { name: 'Hades', path: '/jeux/hades' },
];

describe('fil d’Ariane', () => {
  it('numérote les étapes avec leurs adresses complètes, sans préfixe en français', () => {
    expect(breadcrumbList(crumbs, 'https://achievers.games', 'fr')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Jeux', item: 'https://achievers.games/jeux' },
        {
          '@type': 'ListItem',
          position: 2,
          name: 'Hades',
          item: 'https://achievers.games/jeux/hades',
        },
      ],
    });
  });

  it('garde la langue de la page dans les adresses', () => {
    const items = breadcrumbList(crumbs, 'https://achievers.games', 'en').itemListElement;
    expect(items.map((item) => item.item)).toEqual([
      'https://achievers.games/en/jeux',
      'https://achievers.games/en/jeux/hades',
    ]);
  });
});
