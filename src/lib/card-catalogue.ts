/**
 * Le catalogue des cartes animées, versionné avec le site : chaque jeu y déclare le dossier de ses
 * trois éditions. L'entretien le recopie en base (`CardFamily`, `GameEdition`) ; la galerie de
 * développement le lit directement. Un jeu n'entre dans le catalogue qu'avec ses trois raretés.
 */
import type { EditionKind } from '#prisma';
import data from './card-catalogue.json';

export interface CatalogueGame {
  name: string;
  /** Le jeu Steam qui donne la famille : ses versions sur les autres plateformes en héritent. */
  steamAppId: string;
  /** Un jeu désactivé reste dans les collections mais ne sort plus des boosters. */
  enabled: boolean;
  editions: Record<EditionKind, string>;
}

export const CARD_CATALOGUE: readonly CatalogueGame[] = data.games;
