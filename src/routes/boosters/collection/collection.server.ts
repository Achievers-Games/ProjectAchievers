import { EDITIONS } from '#lib/boosters';
import { collectionPage, decodeCursor } from '#lib/server/boosters';
import { bannerProgress } from '#lib/server/card-banner';
import type { EditionKind } from '#prisma';

/** Les filtres de la collection, lus dans l'adresse : rareté, nom de jeu et curseur. */
export function collectionFilters(url: URL) {
  const asked = url.searchParams.get('edition')?.toUpperCase();
  const kind = EDITIONS.includes(asked as EditionKind) ? (asked as EditionKind) : null;
  const search = url.searchParams.get('q')?.trim().slice(0, 80) ?? '';
  const cursor = decodeCursor(url.searchParams.get('curseur'));
  return { kind, search, cursor };
}

/** Une page de cartes, avec l'avancement qui décide si chacune peut devenir la bannière. */
export async function collectionCards(
  userId: string,
  filters: ReturnType<typeof collectionFilters>,
) {
  const page = await collectionPage(userId, filters);
  const progress = await bannerProgress(
    userId,
    page.cards.map((card) => card.familyKey),
  );
  return {
    next: page.next,
    cards: page.cards.map((card) => ({
      ...card,
      bannerCompletion: card.enabled ? (progress.get(card.familyKey) ?? null) : null,
    })),
  };
}
