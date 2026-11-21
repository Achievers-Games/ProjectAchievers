/**
 * Le catalogue des cartes animées, versionné avec le site : chaque jeu y déclare le dossier
 * d'atelier de ses trois éditions et une version. L'entretien le recopie en base (`CardFamily`,
 * `GameEdition`) ; la galerie de développement le lit directement. Un jeu n'entre dans le
 * catalogue qu'avec ses trois raretés.
 *
 * Les cartes publiées vivent hors de l'image du site, sous `/cartes/<dossier>/<version>/` :
 * une adresse n'est jamais réécrite, donc Cloudflare la garde en cache pour toujours. Retoucher
 * une carte, c'est publier la version suivante (`scripts/publish-cards.mjs`).
 */
import type { EditionKind } from '#prisma';
import data from './card-catalogue.json';

export interface CatalogueGame {
  name: string;
  /** Le jeu Steam qui donne la famille : ses versions sur les autres plateformes en héritent. */
  steamAppId: string;
  /** Un jeu désactivé reste dans les collections mais ne sort plus des boosters. */
  enabled: boolean;
  /** Version publiée des cartes du jeu : l'incrémenter avec chaque retouche publiée. */
  version: number;
  /** Le dossier d'atelier de chaque édition, sous `static/_proto/`. */
  editions: Record<EditionKind, string>;
}

export const CARD_CATALOGUE: readonly CatalogueGame[] = data.games;

/** Le préfixe public des cartes publiées. */
export const CARDS_URL = '/cartes';

/** L'adresse publiée d'une édition, celle que la base enregistre. */
export const publishedCardPath = (game: CatalogueGame, kind: EditionKind) =>
  `${CARDS_URL}/${game.editions[kind]}/${game.version}/`;

/** L'adresse d'atelier d'une édition, servie en développement seulement. */
export const workshopCardPath = (game: CatalogueGame, kind: EditionKind) =>
  `/_proto/${game.editions[kind]}/`;
