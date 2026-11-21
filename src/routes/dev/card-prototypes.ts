import { CARD_CATALOGUE, workshopCardPath } from '#lib/card-catalogue';

/** Les indices de révélation de la démo, en attendant ceux calculés depuis la base. */
const CLUES: Record<
  string,
  { genres: string[]; achievements: number; medianMinutes: number | null }
> = {
  '1057090': { genres: ['platformer', 'metroidvania'], achievements: 39, medianMinutes: 1500 },
  '1145360': { genres: ['roguelike'], achievements: 49, medianMinutes: 5400 },
  '367520': { genres: ['metroidvania', 'soulslike'], achievements: 63, medianMinutes: 3600 },
  '814380': { genres: ['action', 'soulslike'], achievements: 34, medianMinutes: null },
  '620': { genres: ['puzzle', 'science-fiction'], achievements: 51, medianMinutes: null },
};

/** Les jeux du catalogue de cartes, pour la galerie et le simulateur de boosters. */
export const PROTOTYPES = CARD_CATALOGUE.map((game) => ({
  name: game.name,
  // La galerie montre l'atelier : une retouche s'y voit avant d'être publiée.
  assetPath: workshopCardPath(game, 'RELIEF'),
  mythiqueAssetPath: workshopCardPath(game, 'MYTHIQUE'),
  clues: CLUES[game.steamAppId] ?? { genres: [], achievements: 0, medianMinutes: null },
}));
