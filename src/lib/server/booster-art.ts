import { withEditionStill } from '#lib/animated-card';
import { bannerProgress } from './card-banner';
import { cardClues, editionAssets, familyArt, type BoosterCard } from './boosters';

/**
 * Ajoute à chaque carte le nom et l'image de son jeu, le dossier de sa carte animée, et les
 * indices qui font monter la tension avant de retourner une carte rare.
 */
export async function withArt(userId: string, cards: BoosterCard[]) {
  const rare = cards.filter((card) => card.kind !== 'RELIEF').map((card) => card.familyKey);
  const families = cards.map((card) => card.familyKey);
  const [art, assets, clues, progress] = await Promise.all([
    familyArt(families),
    editionAssets(cards.map((card) => card.editionId)),
    cardClues(rare),
    bannerProgress(userId, families),
  ]);
  return cards.map((card) => ({
    ...card,
    game: withEditionStill(art.get(card.familyKey), assets.get(card.editionId)),
    assetPath: assets.get(card.editionId) ?? null,
    bannerCompletion: progress.get(card.familyKey) ?? null,
    clues: card.kind === 'RELIEF' ? null : (clues.get(card.familyKey) ?? null),
  }));
}
